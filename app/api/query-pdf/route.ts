import { NextRequest, NextResponse } from "next/server";
import { pipeline } from "@xenova/transformers";

import { Pinecone } from "@pinecone-database/pinecone";

const CONFIG = {
  MAX_CHUNKS: 10,
  MAX_CONTEXT_CHARS: 12000,
  MIN_RELEVANCE_SCORE: 0.15, // Higher threshold for quality
  CONTEXT_SEARCH_THRESHOLD: 0.25, // Threshold to search other documents
  PRIMARY_DOCUMENT_THRESHOLD: 0.2, // Minimum score to find answer in recent doc
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

    allResults.matches.forEach((match) => {
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

async function searchInDocument(
  query: string,
  documentName: string
): Promise<any> {
  try {
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
      topK: 20,
      includeMetadata: true,
      filter: {
        source: { $eq: documentName },
      },
    });

    return result;
  } catch (error) {
    console.error(`❌ Error searching in ${documentName}:`, error);
    return { matches: [] };
  }
}

async function performContextualSearch(query: string, isGeneric: boolean) {
  console.log(
    `🔍 Performing ${
      isGeneric ? "GENERIC" : "CONTEXTUAL"
    } search for: "${query}"`
  );

  const mostRecentDoc = await getMostRecentDocument();

  if (!mostRecentDoc) {
    console.log("❌ No recent document found");
    return null;
  }

  console.log(`📄 Context: Most recent upload is "${mostRecentDoc}"`);

  if (isGeneric) {
    console.log("🎯 GENERIC QUERY: Searching only in most recent document");
    const recentDocResult = await searchInDocument(query, mostRecentDoc);

    return {
      matches: recentDocResult.matches || [],
      primarySource: mostRecentDoc,
      searchStrategy: "recent_document_only",
      contextMessage: `Answering based on the most recently uploaded document: ${mostRecentDoc}`,
    };
  }

  console.log("🎯 SPECIFIC QUERY: Searching recent document first...");
  const recentDocResult = await searchInDocument(query, mostRecentDoc);

  const bestScoreInRecentDoc = Math.max(
    ...(recentDocResult.matches || []).map((m: any) => m.score || 0)
  );

  console.log(
    `📊 Best score in "${mostRecentDoc}": ${bestScoreInRecentDoc.toFixed(3)}`
  );

  if (bestScoreInRecentDoc >= CONFIG.PRIMARY_DOCUMENT_THRESHOLD) {
    console.log(
      `✅ Found relevant content in recent document (score: ${bestScoreInRecentDoc.toFixed(
        3
      )})`
    );

    return {
      matches: recentDocResult.matches || [],
      primarySource: mostRecentDoc,
      searchStrategy: "recent_document_sufficient",
      contextMessage: `Found relevant information in the most recent document: ${mostRecentDoc}`,
    };
  }

  if (bestScoreInRecentDoc < CONFIG.CONTEXT_SEARCH_THRESHOLD) {
    console.log(
      `⚠️ Low relevance in recent doc (${bestScoreInRecentDoc.toFixed(
        3
      )}) - might not contain this topic`
    );

    const extractor = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2"
    );
    const queryEmbedding = await extractor(query, {
      pooling: "mean",
      normalize: true,
    });

    const globalResult = await index.namespace("pdf-data").query({
      vector: Array.from(queryEmbedding.data),
      topK: 30,
      includeMetadata: true,
    });

    const bestGlobalScore = Math.max(
      ...(globalResult.matches || []).map((m) => m.score || 0)
    );
    console.log(`📊 Best global score: ${bestGlobalScore.toFixed(3)}`);

    if (bestGlobalScore > CONFIG.PRIMARY_DOCUMENT_THRESHOLD) {
      const otherDocSources = [
        ...new Set(
          (globalResult.matches || [])
            .filter(
              (m) =>
                m.metadata?.source !== mostRecentDoc &&
                (m.score || 0) > CONFIG.PRIMARY_DOCUMENT_THRESHOLD
            )
            .map((m) => m.metadata?.source)
        ),
      ];

      console.log(
        `🔄 Found better matches in other documents: [${otherDocSources.join(
          ", "
        )}]`
      );

      return {
        matches: globalResult.matches || [],
        primarySource: mostRecentDoc,
        searchStrategy: "cross_document_search",
        contextMessage: `This topic was not found in the recent document "${mostRecentDoc}", but was found in: ${otherDocSources.join(
          ", "
        )}`,
        suggestNotInRecent: true,
        alternativeSources: otherDocSources,
      };
    } else {
      console.log(`❌ Topic not found in any document`);

      return {
        matches: [],
        primarySource: mostRecentDoc,
        searchStrategy: "topic_not_found",
        contextMessage: `This topic was not found in "${mostRecentDoc}" or any other uploaded documents.`,
        topicNotFound: true,
      };
    }
  }

  return {
    matches: recentDocResult.matches || [],
    primarySource: mostRecentDoc,
    searchStrategy: "recent_document_moderate",
    contextMessage: `Partial information found in recent document: ${mostRecentDoc}`,
  };
}

function isGenericQuery(query: string): boolean {
  const queryLower = query.toLowerCase().trim();
  const genericIndicators = [
    "what is this pdf about",
    "what is this document about",
    "summary",
    "overview",
    "main points",
    "key points",
    "tell me about this",
    "explain this",
    "summarize",
  ];

  return genericIndicators.some((indicator) => queryLower.includes(indicator));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const query = body.query;

    if (!query) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    console.log("🔍 Query received:", query);
    const isGeneric = isGenericQuery(query);

    const searchResult = await performContextualSearch(query, isGeneric);

    if (!searchResult) {
      return NextResponse.json({
        matchedChunks: [],
        totalMatches: 0,
        primarySource: null,
        error: "No documents found",
      });
    }

    if (searchResult.topicNotFound) {
      return NextResponse.json({
        matchedChunks: [],
        totalMatches: 0,
        primarySource: searchResult.primarySource,
        contextMessage: searchResult.contextMessage,
        searchStrategy: searchResult.searchStrategy,
        suggestion:
          "This topic doesn't appear to be covered in any of your uploaded documents.",
      });
    }

    if (!searchResult.matches || searchResult.matches.length === 0) {
      return NextResponse.json({
        matchedChunks: [],
        totalMatches: 0,
        primarySource: searchResult.primarySource,
        contextMessage: searchResult.contextMessage,
      });
    }

    const finalChunks = selectOptimalChunks(
      searchResult.matches,
      CONFIG.MAX_CHUNKS,
      CONFIG.MAX_CONTEXT_CHARS
    );

    const matchedChunks = finalChunks.map((chunk) => ({
      text: chunk.text,
      score: chunk.score,
      id: chunk.id,
      source: chunk.source,
      chunkIndex: chunk.chunkIndex,
      isPrimary: chunk.isPrimary,
    }));

    const sources = [...new Set(finalChunks.map((c) => c.source))];
    const totalChars = finalChunks.reduce((sum, c) => sum + c.text.length, 0);

    console.log("📝 Final Result:");
    console.log(`  • Strategy: ${searchResult.searchStrategy}`);
    console.log(`  • Primary Source: ${searchResult.primarySource}`);
    console.log(`  • Sources Used: [${sources.join(", ")}]`);
    console.log(`  • Chunks: ${finalChunks.length}`);

    return NextResponse.json({
      matchedChunks,
      totalMatches: searchResult.matches.length,
      primarySource: searchResult.primarySource,
      searchStrategy: searchResult.searchStrategy,
      contextMessage: searchResult.contextMessage,
      sourceBreakdown: sources.map((source) => ({
        source,
        chunks: finalChunks.filter((c) => c.source === source).length,
      })),
      queryInfo: {
        original: query,
        isGeneric,
        searchStrategy: searchResult.searchStrategy,
        chunksUsed: finalChunks.length,
        totalCharacters: totalChars,
        suggestNotInRecent: searchResult.suggestNotInRecent || false,
        alternativeSources: searchResult.alternativeSources || [],
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
  matches: any[],
  maxChunks: number,
  maxChars: number
): any[] {
  return matches.slice(0, maxChunks).map((match) => ({
    text: match.metadata?.text || "",
    score: match.score || 0,
    id: match.id,
    source: match.metadata?.source || "unknown",
    chunkIndex: match.metadata?.chunkIndex,
    isPrimary: true,
  }));
}
