import { NextRequest, NextResponse } from "next/server";
import { pipeline } from "@xenova/transformers";
import { Pinecone } from "@pinecone-database/pinecone";
import dotenv from "dotenv";

dotenv.config();

export const runtime = "nodejs";

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!,
});

const index = pinecone.Index(process.env.PINECONE_INDEX_NAME!);

function isGenericQuery(query: string): boolean {
  const queryLower = query.toLowerCase().trim();

  const cleanQuery = queryLower.replace(/[^\w\s]/g, "").replace(/\s+/g, " ");

  const genericIndicators = [
    "bullet points",
    "summary",
    "overview",
    "what is this pdf about",
    "what is this document about",
    "tell me about this pdf",
    "tell me about this document",
    "explain this pdf",
    "explain this document",
    "main points",
    "key points",
    "summarize",
    "content",
    "topics",
  ];

  return genericIndicators.some((indicator) =>
    cleanQuery.includes(indicator.replace(/[^\w\s]/g, "").replace(/\s+/g, " "))
  );
}

function getMostRecentDocument(matchesByDocument: {
  [key: string]: any[];
}): string | null {
  let mostRecentDoc = null;
  let latestTimestamp = 0;

  Object.entries(matchesByDocument).forEach(([source, matches]) => {
    const timestamp = matches[0]?.metadata?.timestamp || 0;
    if (Number(timestamp) > latestTimestamp) {
      latestTimestamp = Number(timestamp);
      mostRecentDoc = source;
    }
  });

  return mostRecentDoc;
}

function enhanceQuery(originalQuery: string, mostRecentDoc?: string): string {
  if (!isGenericQuery(originalQuery) || !mostRecentDoc) {
    return originalQuery;
  }

  const filename = mostRecentDoc.replace(/\.[^/.]+$/, "").replace(/_/g, " ");

  const enhancements: { [key: string]: string } = {
    "bullet points": `key points and bullet points from ${filename} document`,
    summary: `comprehensive summary of ${filename} document`,
    overview: `overview and main topics from ${filename} document`,
    "what is this pdf about": `what is the ${filename} document about, its main topics and purpose`,
    "what is this document about": `what is the ${filename} document about, its main topics and purpose`,
  };

  const enhanced = enhancements[originalQuery.toLowerCase().trim()];
  return enhanced || `${originalQuery} from ${filename}`;
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
    console.log("🎯 Generic query detected:", isGeneric);

    // Check index stats first
    const stats = await index.describeIndexStats();
    console.log("📊 Index Stats:", stats);

    // Step 1: Embed query
    const extractor = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2"
    );

    const queryEmbedding = await extractor(query, {
      pooling: "mean",
      normalize: true,
    });

    console.log(
      "🔢 Query vector dimensions:",
      Array.from(queryEmbedding.data).length
    );

    const result = await index.namespace("pdf-data").query({
      vector: Array.from(queryEmbedding.data),
      topK: 25,
      includeMetadata: true,
      includeValues: false,
    });

    console.log("🔍 Pinecone matches:", result.matches?.length || 0);

    if (result.matches && result.matches.length > 0) {
      console.log("🔍 First match metadata:", result.matches[0].metadata);
      console.log("🔍 Source field:", result.matches[0].metadata?.source);
      console.log("🔍 Filename field:", result.matches[0].metadata?.filename);

      const matchesByDocument: { [key: string]: any[] } = {};

      result.matches.forEach((match) => {
        const source = String(
          match.metadata?.source || match.metadata?.filename || "unknown"
        );
        if (!matchesByDocument[source]) {
          matchesByDocument[source] = [];
        }
        matchesByDocument[source].push(match);
      });

      console.log("📚 Documents found:", Object.keys(matchesByDocument));

      let finalChunks: any[] = [];
      let primarySource: string = "";
      let rankedSources: any[] = [];

      if (isGeneric) {
        const recentDoc = getMostRecentDocument(matchesByDocument);

        if (recentDoc && matchesByDocument[recentDoc]) {
          primarySource = recentDoc;

          const recentDocChunks = matchesByDocument[recentDoc]
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .slice(0, 10)
            .map((match) => ({
              text:
                typeof match.metadata?.text === "string"
                  ? match.metadata.text
                  : null,
              score: match.score ?? 0,
              id: match.id,
              source: recentDoc,
              chunkIndex: match.metadata?.chunkIndex,
              isPrimary: true,
            }))
            .filter((chunk) => chunk.text !== null);

          finalChunks = recentDocChunks;

          console.log(
            `🎯 GENERIC QUERY: Using ${finalChunks.length} chunks from most recent document: ${recentDoc}`
          );
          console.log(
            `📅 Recent doc timestamp: ${matchesByDocument[recentDoc][0]?.metadata?.timestamp}`
          );
        } else {
          console.log("❌ No recent document found for generic query");
        }
      } else {
        const currentTime = Date.now();

        const rankedSources = Object.entries(matchesByDocument)
          .map(([source, matches]) => {
            const maxScore = Math.max(...matches.map((m) => m.score || 0));
            const avgScore =
              matches.reduce((sum, m) => sum + (m.score || 0), 0) /
              matches.length;
            const timestamp = matches[0]?.metadata?.timestamp || 0;
            const matchCount = matches.length;

            const ageInMinutes =
              (currentTime - Number(timestamp)) / (1000 * 60);
            let recencyBoost = 0;

            if (ageInMinutes < 5) recencyBoost = 0.2;
            else if (ageInMinutes < 30) recencyBoost = 0.1;
            else if (ageInMinutes < 120) recencyBoost = 0.05;

            const finalScore = maxScore + recencyBoost;

            return {
              source,
              matches,
              maxScore,
              avgScore,
              finalScore,
              timestamp: Number(timestamp),
              matchCount,
              recencyBoost,
              ageInMinutes,
            };
          })
          .sort((a, b) => {
            if (Math.abs(a.finalScore - b.finalScore) > 0.05) {
              return b.finalScore - a.finalScore;
            }

            return b.timestamp - a.timestamp;
          });

        console.log(
          "🏆 Ranked sources:",
          rankedSources.map((s) => ({
            source: s.source,
            maxScore: s.maxScore.toFixed(3),
            timestamp: s.timestamp,
            matches: s.matchCount,
          }))
        );

        const PRIMARY_SOURCE_CHUNKS = 8;
        const SECONDARY_SOURCE_CHUNKS = 2;

        if (rankedSources[0]) {
          primarySource = rankedSources[0].source;

          const primaryThreshold = Math.min(
            rankedSources[0].maxScore * 0.7,
            0.05
          );

          const primaryChunks = rankedSources[0].matches
            .filter((m) => (m.score ?? 0) > primaryThreshold)
            .slice(0, PRIMARY_SOURCE_CHUNKS)
            .map((match) => ({
              text:
                typeof match.metadata?.text === "string"
                  ? match.metadata.text
                  : null,
              score: match.score ?? 0,
              id: match.id,
              source: rankedSources[0].source,
              chunkIndex: match.metadata?.chunkIndex,
              isPrimary: true,
            }))
            .filter((chunk) => chunk.text !== null);

          finalChunks.push(...primaryChunks);
          console.log(
            `✅ Using ${primaryChunks.length} chunks from PRIMARY source: ${
              rankedSources[0].source
            } (threshold: ${primaryThreshold.toFixed(3)})`
          );
        }

        if (rankedSources[1] && finalChunks.length < 4) {
          const secondarySource = rankedSources[1];

          const secondaryThreshold = Math.min(
            secondarySource.maxScore * 0.8,
            0.08
          );

          const secondaryChunks = secondarySource.matches
            .filter((m) => (m.score ?? 0) > secondaryThreshold)
            .slice(0, SECONDARY_SOURCE_CHUNKS)
            .map((match) => ({
              text:
                typeof match.metadata?.text === "string"
                  ? match.metadata.text
                  : null,
              score: match.score ?? 0,
              id: match.id,
              source: secondarySource.source,
              chunkIndex: match.metadata?.chunkIndex,
              isPrimary: false,
            }))
            .filter((chunk) => chunk.text !== null);

          finalChunks.push(...secondaryChunks);
          console.log(
            `➕ Added ${secondaryChunks.length} chunks from secondary source: ${
              secondarySource.source
            } (threshold: ${secondaryThreshold.toFixed(3)})`
          );
        }

        finalChunks = finalChunks.sort((a, b) => {
          if (a.isPrimary !== b.isPrimary) {
            return a.isPrimary ? -1 : 1;
          }
          return (b.score || 0) - (a.score || 0);
        });
      }

      console.log("📝 Final context sources:", [
        ...new Set(finalChunks.map((c) => c.source)),
      ]);
      console.log(
        "📝 Context length:",
        finalChunks.map((c) => c.text?.length || 0).reduce((a, b) => a + b, 0)
      );

      return NextResponse.json(
        {
          matchedChunks: finalChunks,
          totalMatches: result.matches?.length || 0,
          primarySource,
          sourceBreakdown: isGeneric
            ? primarySource
              ? [
                  {
                    source: primarySource,
                    strategy: "most_recent",
                    chunks: finalChunks.length,
                    timestamp:
                      matchesByDocument[primarySource]?.[0]?.metadata
                        ?.timestamp,
                  },
                ]
              : []
            : (rankedSources || []).map((s) => ({
                source: s.source,
                relevance: s.maxScore?.toFixed(3),
                finalScore: s.finalScore?.toFixed(3),
                recencyBoost: s.recencyBoost?.toFixed(3),
                ageMinutes: Math.round(s.ageInMinutes || 0),
                chunks: s.matchCount,
              })),
          queryInfo: {
            original: query,
            isGeneric,
            strategy: isGeneric ? "recent_document" : "relevance_based",
            enhanced: primarySource
              ? enhanceQuery(query, primarySource)
              : query,
          },
          indexStats: stats,
        },
        { status: 200 }
      );
    } else {
      console.log("❌ NO MATCHES FOUND");
      return NextResponse.json(
        {
          matchedChunks: [],
          totalMatches: 0,
          indexStats: stats,
        },
        { status: 200 }
      );
    }
  } catch (err: any) {
    console.error("❌ Error:", err.message);
    return NextResponse.json(
      { error: "Server error", details: err.message },
      { status: 500 }
    );
  }
}
