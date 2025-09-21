import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { question } = await req.json();

    if (!question) {
      return NextResponse.json(
        { error: "Question is required" },
        { status: 400 }
      );
    }

    console.log("🔍 Question received:", question);

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

    const queryResponse = await fetch(`${baseUrl}/api/query-pdf`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: question }),
    });

    if (!queryResponse.ok) {
      throw new Error(`Query-PDF API error: ${queryResponse.status}`);
    }

    const queryData = await queryResponse.json();
    const { matchedChunks, primarySource, queryInfo } = queryData;

    if (!matchedChunks || matchedChunks.length === 0) {
      return NextResponse.json({
        answer: `I couldn't find any relevant information in your most recent document (${
          primarySource || "unknown document"
        }) to answer your question. You might want to try rephrasing your question or asking about different topics covered in this document.`,
        matchedChunks: [],
        primarySource: primarySource,
        queryInfo: queryInfo,
      });
    }

    const contextWithSources = matchedChunks
      .map((chunk: any) => {
        return `[From: ${chunk.source}]\n${chunk.text}`;
      })
      .join("\n\n---\n\n");

    console.log("📝 Document being analyzed:", primarySource);
    console.log("📝 Context length:", contextWithSources.length);
    console.log("📝 Chunks used:", matchedChunks.length);

    const prompt = `
You are a helpful assistant analyzing a PDF document. Answer the user's question based on the provided context from their most recently uploaded document.

DOCUMENT INFORMATION:
- Document: "${primarySource}"
- This is the user's most recently uploaded PDF
- Search quality: ${
      queryInfo?.bestScore
        ? `${(queryInfo.bestScore * 100).toFixed(1)}%`
        : "Standard"
    }

Context from the document:
${contextWithSources}

User's Question: ${question}

Instructions:
- Answer based ONLY on the provided context from "${primarySource}"
- Be specific and cite relevant details from the text
- If the context doesn't fully answer the question, acknowledge what's missing and suggest the user might want to ask about other aspects of this document
- Stay focused on this single document - do not speculate about information not present in the context
- If the search quality seems low, mention that the user might want to rephrase their question for better results

Answer:
`.trim();

    console.log("🔍 Sending to Claude for document:", primarySource);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY environment variable is not set");
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ Anthropic API error:", response.status, errorText);
      throw new Error(
        `Anthropic API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    const assistantMessage =
      data?.content?.[0]?.text ?? "No response from Claude.";

    return NextResponse.json({
      answer: assistantMessage,
      primarySource: primarySource,
      sourcesUsed: [primarySource],
      matchedChunks: matchedChunks,
      queryInfo: queryInfo,
      searchStrategy: "recent_document_only",
      debugInfo: {
        document: primarySource,
        chunksUsed: matchedChunks.length,
        searchQuality: queryInfo?.bestScore
          ? `${(queryInfo.bestScore * 100).toFixed(1)}%`
          : "N/A",
        contextLength: contextWithSources.length,
      },
    });
  } catch (err: any) {
    console.error("❌ Error in get-answer:", err);
    return NextResponse.json(
      { error: "Internal Server Error", details: err.message },
      { status: 500 }
    );
  }
}
