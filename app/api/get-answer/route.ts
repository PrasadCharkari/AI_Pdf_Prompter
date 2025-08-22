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

    const queryResponse = await fetch(
      `${
        process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"
      }/api/query-pdf`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: question }),
      }
    );

    if (!queryResponse.ok) {
      throw new Error(`Query-PDF API error: ${queryResponse.status}`);
    }

    const queryData = await queryResponse.json();
    const { matchedChunks, primarySource, queryInfo, sourceBreakdown } =
      queryData;

    if (!matchedChunks || matchedChunks.length === 0) {
      return NextResponse.json({
        answer:
          "I couldn't find any relevant information in the uploaded PDFs to answer your question.",
        matchedChunks: [],
        primarySource: null,
      });
    }

    const contextWithSources = matchedChunks
      .map((chunk: any) => {
        return `[From: ${chunk.source}]\n${chunk.text}`;
      })
      .join("\n\n---\n\n");

    console.log("📝 Final context sources:", [
      ...new Set(matchedChunks.map((c: any) => c.source)),
    ]);
    console.log("📝 Context length:", contextWithSources.length);

    const prompt = `
You are a helpful assistant analyzing PDF documents. Answer the user's question based on the provided context.

CONTEXT INFORMATION:
- Primary document: "${primarySource}"
- Query was: "${queryInfo?.original}"
${
  queryInfo?.analysis?.isGeneric
    ? "- This appears to be a general question about the document content"
    : "- This appears to be a specific question"
}
${
  queryInfo?.enhanced && queryInfo.enhanced !== queryInfo.original
    ? `- Enhanced query context: "${queryInfo.enhanced}"`
    : ""
}

Context from documents:
${contextWithSources}

Original Question: ${question}

Instructions:
- Answer based on the provided context, focusing primarily on the primary document: "${primarySource}"
- Be specific and cite relevant details from the text
- If information comes from multiple documents, clearly indicate which document you're referencing
- If the context doesn't fully answer the question, acknowledge what's missing
- For general questions (summaries, bullet points, overviews), provide comprehensive coverage of the main topics

Answer:
`.trim();

    console.log("🔍 Sending to Claude with primary source:", primarySource);

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
      sourcesUsed: [...new Set(matchedChunks.map((c: any) => c.source))],
      matchedChunks: matchedChunks,
      queryInfo: queryInfo,
      totalDocumentsFound: sourceBreakdown?.length || 0,
      debugInfo: {
        totalMatches: queryData.totalMatches,
        chunksUsed: matchedChunks.length,
        documentRanking: sourceBreakdown,
        queryEnhancement: {
          original: queryInfo?.original,
          enhanced: queryInfo?.enhanced,
          wasGeneric: queryInfo?.analysis?.isGeneric,
        },
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
