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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const queryText = body.query;

    if (!queryText) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    const extractor = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2"
    );
    const embedding = await extractor(queryText, {
      pooling: "mean",
      normalize: true,
    });

    const queryVector = Array.from(embedding.data);
    console.log("🧠 Query Vector:", queryVector.slice(0, 10), "...");

    const results = await index.query({
      topK: 5,
      includeMetadata: true,
      includeValues: false,
      vector: queryVector,
    });

    console.log(
      "📦 Raw Results from Pinecone:",
      JSON.stringify(results, null, 2)
    );

    const matchedChunks =
      results.matches?.map((match) => ({
        score: match.score,
        text: match.metadata?.text,
      })) || [];

    console.log("🎯 Matched Chunks:", matchedChunks);

    return NextResponse.json({ matchedChunks });
  } catch (err: any) {
    console.error("❌ Error in /api/debug-query:", err);
    return NextResponse.json(
      { error: "Server error", details: err.message },
      { status: 500 }
    );
  }
}
