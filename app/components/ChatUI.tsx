
"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Bot, User } from "lucide-react";

interface Message {
    id: string;
    text: string;
    sender: "user" | "ai";
    timestamp: Date;
}

interface ChatProps {
    chunks: string[];
    initialMessage?: string;
}

export default function Chat({ chunks, initialMessage }: ChatProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);


    useEffect(() => {
        if (initialMessage) {
            const welcomeMessage: Message = {
                id: "welcome",
                text: "Let's talk about this PDF! " + initialMessage,
                sender: "ai",
                timestamp: new Date(),
            };
            setMessages([welcomeMessage]);


            if (initialMessage.includes("summary")) {
                handleSendMessage(initialMessage, true);
            }
        } else {

            const welcomeMessage: Message = {
                id: "welcome",
                text: "Hi! I'm ready to help you explore your PDF. What would you like to know?",
                sender: "ai",
                timestamp: new Date(),
            };
            setMessages([welcomeMessage]);
        }
    }, [initialMessage]);

    const handleSendMessage = async (messageText?: string, isAutomatic = false) => {
        const messageToSend = messageText || input;
        if (!messageToSend.trim()) return;

        if (!isAutomatic) {
            const userMessage: Message = {
                id: Date.now().toString(),
                text: messageToSend,
                sender: "user",
                timestamp: new Date(),
            };
            setMessages(prev => [...prev, userMessage]);
        }

        setInput("");
        setLoading(true);

        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

        try {
            const response = await fetch(`${baseUrl}/api/get-answer`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    question: messageToSend,
                }),
            });

            const data = await response.json();

            const aiMessage: Message = {
                id: (Date.now() + 1).toString(),
                text: data.answer || "I'm sorry, I couldn't process that request.",
                sender: "ai",
                timestamp: new Date(),
            };

            setMessages(prev => [...prev, aiMessage]);
        } catch (error) {
            console.error("Error:", error);
            const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                text: "Sorry, I encountered an error. Please try again.",
                sender: "ai",
                timestamp: new Date(),
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setLoading(false);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    return (
        <div className="flex flex-col h-full bg-white">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6 shadow-lg">
                <h2 className="text-2xl font-bold flex items-center gap-2">
                    <Bot className="h-6 w-6" />
                    PDF Chat Assistant
                </h2>
                <p className="text-blue-100 mt-1">Ask me anything about your document</p>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <AnimatePresence initial={false}>
                    {messages.map((message, index) => (
                        <motion.div
                            key={message.id}
                            initial={{ opacity: 0, y: 20, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -20, scale: 0.95 }}
                            transition={{ duration: 0.3, delay: index * 0.1 }}
                            className={`flex ${message.sender === "user" ? "justify-end" : "justify-start"}`}
                        >
                            <div
                                className={`
                  max-w-xs lg:max-w-md px-4 py-3 rounded-2xl shadow-sm
                  ${message.sender === "user"
                                        ? "bg-gradient-to-r from-blue-500 to-blue-600 text-white"
                                        : "bg-gray-100 text-gray-800 border"
                                    }
                `}
                            >
                                <div className="flex items-start gap-2">
                                    {message.sender === "ai" && (
                                        <Bot className="h-4 w-4 mt-1 text-blue-500 flex-shrink-0" />
                                    )}
                                    {message.sender === "user" && (
                                        <User className="h-4 w-4 mt-1 text-blue-100 flex-shrink-0" />
                                    )}
                                    <div className="flex-1">
                                        <p className="text-sm leading-relaxed whitespace-pre-wrap">
                                            {message.text}
                                        </p>
                                        <p className={`text-xs mt-1 ${message.sender === "user" ? "text-blue-100" : "text-gray-500"
                                            }`}>
                                            {message.timestamp.toLocaleTimeString([], {
                                                hour: '2-digit',
                                                minute: '2-digit'
                                            })}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>

                {/* Loading indicator */}
                {loading && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex justify-start"
                    >
                        <div className="bg-gray-100 rounded-2xl px-4 py-3 border shadow-sm">
                            <div className="flex items-center gap-2">
                                <Bot className="h-4 w-4 text-blue-500" />
                                <div className="flex space-x-1">
                                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t bg-gray-50 p-4">
                <div className="flex gap-3">
                    <div className="flex-1 relative">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyPress={handleKeyPress}
                            placeholder="Ask me anything about your PDF..."
                            className="w-full px-4 py-3 bg-white border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                            rows={1}
                            disabled={loading}
                        />
                    </div>
                    <motion.button
                        onClick={() => handleSendMessage()}
                        disabled={!input.trim() || loading}
                        className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                    >
                        <Send className="h-5 w-5" />
                    </motion.button>
                </div>
            </div>
        </div>
    );
}