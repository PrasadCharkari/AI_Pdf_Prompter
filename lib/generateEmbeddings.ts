import { pipeline } from "@xenova/transformers";

let extractor: any;

export interface ChunkWithMetadata {
  text: string;
  source: string;
  timestamp: number;
  chunkIndex: number;
  pageNumber?: number;
}

export interface EmbeddingResult {
  embedding: number[];
  metadata: ChunkWithMetadata;
}

export async function generateEmbeddings(
  chunks: ChunkWithMetadata[]
): Promise<EmbeddingResult[]> {
  if (!extractor) {
    extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }

  const results: EmbeddingResult[] = [];

  for (const chunkData of chunks) {
    const output = await extractor(chunkData.text, {
      pooling: "mean",
      normalize: true,
    });

    const embedding = output.data as number[];

    results.push({
      embedding,
      metadata: chunkData,
    });
  }

  console.log("🔢 Generated Embeddings with metadata:", results.length);
  console.log("📚 Sources:", [
    ...new Set(results.map((r) => r.metadata.source)),
  ]);

  return results;
}

export async function generateEmbeddingsSimple(
  chunks: string[]
): Promise<number[][]> {
  if (!extractor) {
    extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }

  const embeddings: number[][] = [];

  for (const chunk of chunks) {
    const output = await extractor(chunk, {
      pooling: "mean",
      normalize: true,
    });

    const embedding = output.data as number[];
    embeddings.push(embedding);
  }

  return embeddings;
}
