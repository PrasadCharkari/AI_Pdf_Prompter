import { NextRequest, NextResponse } from "next/server";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { pipeline } from "@xenova/transformers";
import { Pinecone } from "@pinecone-database/pinecone";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";

dotenv.config();

export const runtime = "nodejs";

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!,
});

const index = pinecone.Index(process.env.PINECONE_INDEX_NAME!);

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const filename = file.name;
    const timestamp = Date.now();
    const fileSize = file.size;

    console.log(
      `📄 Processing PDF: ${filename} (${fileSize} bytes) at ${new Date(
        timestamp
      ).toISOString()}`
    );

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const PDFParser = (await import("pdf2json")).default;

    return new Promise((resolve) => {
      const pdfParser = new (PDFParser as any)();

      pdfParser.on("pdfParser_dataError", (errData: any) => {
        resolve(
          NextResponse.json(
            { error: "PDF parsing error", details: errData.parserError },
            { status: 500 }
          )
        );
      });

      pdfParser.on("pdfParser_dataReady", async (pdfData: any) => {
        let text = "";
        let pageTexts: string[] = [];
        pdfData.Pages?.forEach((page: any, pageIndex: number) => {
          let pageText = "";
          page.Texts?.forEach((textItem: any) => {
            textItem.R?.forEach((run: any) => {
              const decodedText = decodeURIComponent(run.T) + " ";
              text += decodedText;
              pageText += decodedText;
            });
          });
          pageTexts.push(pageText);
        });

        const splitter = new RecursiveCharacterTextSplitter({
          chunkSize: 400,
          chunkOverlap: 50,
        });

        const chunks = await splitter.createDocuments([text]);

        console.log(`📄 Created ${chunks.length} chunks from ${filename}`);
        console.log(
          "📄 First chunk preview:",
          chunks[0]?.pageContent?.substring(0, 100)
        );

        const extractor = await pipeline(
          "feature-extraction",
          "Xenova/all-MiniLM-L6-v2"
        );

        const vectors = await Promise.all(
          chunks.map(async (chunk, chunkIndex) => {
            const embedding = await extractor(chunk.pageContent, {
              pooling: "mean",
              normalize: true,
            });

            const estimatedPage =
              Math.floor((chunkIndex / chunks.length) * pageTexts.length) + 1;

            return {
              id: `${filename.replace(
                /[^a-zA-Z0-9]/g,
                "_"
              )}-chunk-${chunkIndex}-${timestamp}`,
              values: Array.from(embedding.data),
              metadata: {
                text: chunk.pageContent,

                source: filename,
                filename: filename,
                timestamp: timestamp,
                uploadDate: new Date(timestamp).toISOString(),
                chunkIndex: chunkIndex,
                totalChunks: chunks.length,
                estimatedPage: estimatedPage,
                fileSize: fileSize,

                documentId: `${filename}-${timestamp}`,
              },
            };
          })
        );

        try {
          await index.namespace("pdf-data").upsert(vectors);

          console.log(
            `✅ Successfully stored ${vectors.length} vectors from ${filename}`
          );
          console.log(`📊 Document ID: ${filename}-${timestamp}`);
          console.log(`🕒 Upload timestamp: ${timestamp}`);

          resolve(
            NextResponse.json(
              {
                message: "PDF processed and stored successfully",
                filename: filename,
                documentId: `${filename}-${timestamp}`,
                chunks: vectors.length,
                timestamp: timestamp,
                uploadDate: new Date(timestamp).toISOString(),

                chunkPreviews: chunks.slice(0, 3).map((c, i) => ({
                  index: i,
                  preview: c.pageContent.substring(0, 100) + "...",
                })),
              },
              { status: 200 }
            )
          );
        } catch (error: any) {
          console.error("❌ Upsert Error:", error.message);

          if (
            error.message &&
            error.message.includes("message length too large")
          ) {
            resolve(
              NextResponse.json(
                {
                  error: "File generates too much data for processing",
                  details: `PDF created ${vectors.length} chunks (${
                    (error.message.match(/found (\d+) bytes/) || [])[1]
                  } bytes), but limit is 4MB. Please try a smaller PDF.`,
                  errorType: "SIZE_LIMIT_EXCEEDED",
                },
                { status: 413 }
              )
            );
          } else {
            resolve(
              NextResponse.json(
                {
                  error: "Failed to process PDF",
                  details: error.message || "Unknown error occurred",
                  errorType: "PROCESSING_ERROR",
                },
                { status: 500 }
              )
            );
          }
        }
      });

      pdfParser.parseBuffer(buffer);
    });
  } catch (err: any) {
    console.error("❌ PDF Processing Error:", err);
    return NextResponse.json(
      { error: "Server error", details: err.message },
      { status: 500 }
    );
  }
}
