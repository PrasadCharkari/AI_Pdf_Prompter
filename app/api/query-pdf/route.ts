import { NextRequest, NextResponse } from "next/server";
import { pipeline } from "@xenova/transformers";
import { Pinecone } from "@pinecone-database/pinecone";

interface PineconeMatch {
  id: string;
  score?: number;
  metadata?: {
    text?: string;
    source?: string;
    filename?: string;
    timestamp?: number;
    chunkIndex?: number;
    [key: string]: any;
  };
}

interface SearchResult {
  matches: PineconeMatch[];
  primarySource: string;
  searchStrategy: string;
  bestScore: number;
}

interface ProcessedChunk {
  text: string;
  score: number;
  id: string;
  source: string;
  chunkIndex?: number;
  isPrimary: boolean;
}

const CONFIG = {
  MAX_CHUNKS: 10,
  MAX_CONTEXT_CHARS: 12000,
  MIN_RELEVANCE_SCORE: 0.1,
};

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!,
});

const index = pinecone.Index(process.env.PINECONE_INDEX_NAME!);

async function getMostRecentDocument(): Promise<string | null> {
  try {
    const dummyVector = new Array(384).fill(0);
    const allResults = await index.namespace("pdf-data").query({
      vector: dummyVector,
      topK: 100,
      includeMetadata: true,
    });

    if (!allResults.matches || allResults.matches.length === 0) {
      return null;
    }

    const documentTimestamps: { [key: string]: number } = {};

    allResults.matches.forEach((match: PineconeMatch) => {
      const source = String(
        match.metadata?.source || match.metadata?.filename || "unknown"
      );
      const timestamp = Number(match.metadata?.timestamp || 0);

      if (
        !documentTimestamps[source] ||
        timestamp > documentTimestamps[source]
      ) {
        documentTimestamps[source] = timestamp;
      }
    });

    let mostRecentDoc = null;
    let latestTimestamp = 0;

    Object.entries(documentTimestamps).forEach(([source, timestamp]) => {
      if (timestamp > latestTimestamp) {
        latestTimestamp = timestamp;
        mostRecentDoc = source;
      }
    });

    console.log(
      `🎯 Most recent document: ${mostRecentDoc} (${new Date(
        latestTimestamp
      ).toISOString()})`
    );
    return mostRecentDoc;
  } catch (error) {
    console.error("❌ Error finding recent document:", error);
    return null;
  }
}

async function searchInRecentDocumentOnly(
  query: string,
  documentName: string
): Promise<SearchResult> {
  try {
    console.log(`🔍 Searching ONLY in: "${documentName}"`);

    const extractor = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2"
    );
    const queryEmbedding = await extractor(query, {
      pooling: "mean",
      normalize: true,
    });

    const result = await index.namespace("pdf-data").query({
      vector: Array.from(queryEmbedding.data),
      topK: CONFIG.MAX_CHUNKS * 2,
      includeMetadata: true,
      filter: {
        source: { $eq: documentName },
      },
    });

    const bestScore = Math.max(
      ...(result.matches || []).map((m: PineconeMatch) => m.score || 0)
    );
    console.log(`📊 Best score in "${documentName}": ${bestScore.toFixed(3)}`);
    console.log(`📊 Total chunks found: ${result.matches?.length || 0}`);

    return {
      matches: result.matches || [],
      primarySource: documentName,
      searchStrategy: "recent_document_only",
      bestScore,
    };
  } catch (error) {
    console.error(`❌ Error searching in ${documentName}:`, error);
    return {
      matches: [],
      primarySource: documentName,
      searchStrategy: "search_error",
      bestScore: 0,
    };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const query = body.query;

    if (!query) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    console.log("🔍 Query received:", query);
    console.log("🎯 MODE: Recent document ONLY");

    const mostRecentDoc = await getMostRecentDocument();

    if (!mostRecentDoc) {
      console.log("❌ No documents found");
      return NextResponse.json({
        matchedChunks: [],
        totalMatches: 0,
        primarySource: null,
        error: "No documents found in the system",
      });
    }

    const searchResult = await searchInRecentDocumentOnly(query, mostRecentDoc);

    if (!searchResult.matches || searchResult.matches.length === 0) {
      console.log("❌ No matches found in recent document");
      return NextResponse.json({
        matchedChunks: [],
        totalMatches: 0,
        primarySource: mostRecentDoc,
        searchStrategy: "recent_document_only",
        contextMessage: `No relevant information found in your most recent document: ${mostRecentDoc}. You might want to rephrase your question or ask about different topics covered in this document.`,
      });
    }

    const filteredMatches = searchResult.matches.filter(
      (match: PineconeMatch) => (match.score || 0) >= CONFIG.MIN_RELEVANCE_SCORE
    );

    const finalChunks = selectOptimalChunks(
      filteredMatches.length > 0
        ? filteredMatches
        : searchResult.matches.slice(0, 5),
      CONFIG.MAX_CHUNKS,
      CONFIG.MAX_CONTEXT_CHARS
    );

    const matchedChunks = finalChunks.map((chunk: ProcessedChunk) => ({
      text: chunk.text,
      score: chunk.score,
      id: chunk.id,
      source: chunk.source,
      chunkIndex: chunk.chunkIndex,
      isPrimary: true,
    }));

    const totalChars = finalChunks.reduce((sum, c) => sum + c.text.length, 0);

    console.log("📝 Final Result:");
    console.log(`  • Document: ${mostRecentDoc}`);
    console.log(`  • Chunks Used: ${finalChunks.length}`);
    console.log(`  • Best Score: ${searchResult.bestScore.toFixed(3)}`);
    console.log(`  • Total Characters: ${totalChars}`);

    let contextMessage;
    if (searchResult.bestScore >= 0.3) {
      contextMessage = `Found relevant information in your most recent document: ${mostRecentDoc}`;
    } else if (searchResult.bestScore >= 0.15) {
      contextMessage = `Found some information in your most recent document: ${mostRecentDoc}. The matches are moderate - consider rephrasing for better results.`;
    } else {
      contextMessage = `Searched your most recent document: ${mostRecentDoc}. The matches have low confidence - this topic might not be well covered in this document.`;
    }

    return NextResponse.json({
      matchedChunks,
      totalMatches: searchResult.matches.length,
      primarySource: mostRecentDoc,
      searchStrategy: "recent_document_only",
      contextMessage,
      sourceBreakdown: [
        {
          source: mostRecentDoc,
          chunks: finalChunks.length,
        },
      ],
      queryInfo: {
        original: query,
        searchStrategy: "recent_document_only",
        chunksUsed: finalChunks.length,
        totalCharacters: totalChars,
        bestScore: searchResult.bestScore,
        documentSearched: mostRecentDoc,
      },
    });
  } catch (err: any) {
    console.error("❌ Error in query-pdf:", err);
    return NextResponse.json(
      { error: "Server error", details: err.message },
      { status: 500 }
    );
  }
}

function selectOptimalChunks(
  matches: PineconeMatch[],
  maxChunks: number,
  maxChars: number
): ProcessedChunk[] {
  return matches.slice(0, maxChunks).map((match: PineconeMatch) => ({
    text: match.metadata?.text || "",
    score: match.score || 0,
    id: match.id,
    source: match.metadata?.source || "unknown",
    chunkIndex: match.metadata?.chunkIndex,
    isPrimary: true,
  }));
}
