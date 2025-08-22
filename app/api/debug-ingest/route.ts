import { NextRequest, NextResponse } from "next/server";
import { generateEmbeddings } from "@/lib/generateEmbeddings";
import { pinecone } from "@/lib/pinecone";

const index = pinecone.Index("pdf-index");

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { chunks } = body;

    if (!chunks || !Array.isArray(chunks)) {
      return NextResponse.json(
        { error: "Missing or invalid 'chunks'" },
        { status: 400 }
      );
    }

    const embeddings = await generateEmbeddings(chunks);

    const vectors = embeddings.map((result, idx) => ({
      id: `chunk-${idx}`,
      values: result.embedding,
      metadata: { text: chunks[idx] },
    }));

    try {
      await index.upsert(vectors);
      console.log(`✅ Stored ${vectors.length} vectors in Pinecone`);

      return NextResponse.json({
        message: "Vectors embedded and stored in Pinecone",
        chunks,
      });
    } catch (upsertError: any) {
      console.error("❌ Upsert Error:", upsertError.message);

      if (
        upsertError.message &&
        upsertError.message.includes("message length too large")
      ) {
        return NextResponse.json(
          {
            error: "Data too large for processing",
            details: `${vectors.length} chunks exceed the 4MB batch limit. Please try with fewer chunks.`,
            errorType: "SIZE_LIMIT_EXCEEDED",
          },
          { status: 413 }
        );
      }

      return NextResponse.json(
        {
          error: "Failed to store vectors",
          details: upsertError.message || "Unknown error occurred",
          errorType: "STORAGE_ERROR",
        },
        { status: 500 }
      );
    }
  } catch (err: any) {
    console.error("❌ Error in debug-ingest:", err);
    return NextResponse.json(
      { error: "Server error", details: err.message },
      { status: 500 }
    );
  }
}
