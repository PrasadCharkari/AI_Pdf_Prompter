"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Paperclip, FileText, MessageCircle, BookOpen, CheckCircle, AlertTriangle, X } from "lucide-react";

interface UploadProps {
    onSuccess: (chunks: string[]) => void;
    onSummarize: () => void;
    onStartChat: () => void;
}

export default function Upload({ onSuccess, onSummarize, onStartChat }: UploadProps) {
    const [loading, setLoading] = useState(false);
    const [uploadedFile, setUploadedFile] = useState<File | null>(null);
    const [isUploaded, setIsUploaded] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const getErrorMessage = (error: any, file: File) => {
        const errorString = error.toString().toLowerCase();


        if (errorString.includes('message length too large') ||
            errorString.includes('limit is:') ||
            errorString.includes('4194304')) {
            return {
                title: "File Too Large",
                message: `This PDF (${(file.size / 1024 / 1024).toFixed(1)}MB) generates too much data for processing. Please try a smaller PDF (under 2-3MB recommended).`,
                suggestion: "Try splitting large PDFs into smaller sections or use a more concise document."
            };
        }


        if (file.size > 10 * 1024 * 1024) {
            return {
                title: "File Size Exceeded",
                message: `File size (${(file.size / 1024 / 1024).toFixed(1)}MB) exceeds the 10MB limit.`,
                suggestion: "Please select a smaller PDF file."
            };
        }


        if (errorString.includes('network') || errorString.includes('timeout') || errorString.includes('fetch')) {
            return {
                title: "Network Error",
                message: "Failed to upload due to network issues.",
                suggestion: "Please check your connection and try again."
            };
        }


        if (errorString.includes('server error') || errorString.includes('500')) {
            return {
                title: "Server Error",
                message: "Something went wrong on our servers.",
                suggestion: "Please try again in a few moments."
            };
        }


        return {
            title: "Upload Failed",
            message: "Something went wrong while processing your PDF.",
            suggestion: "PDF size too large, try a smaller PDF (under 2-3MB recommended)"
        };
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploadedFile(file);
        setError(null);
        setIsUploaded(false);


        if (file.size > 10 * 1024 * 1024) {
            setError("File size exceeds 10MB limit. Please select a smaller PDF.");
            return;
        }

        const formData = new FormData();
        formData.append("file", file);

        setLoading(true);

        try {
            const res = await fetch("/api/parse-pdf", {
                method: "POST",
                body: formData,
            });

            const data = await res.json();

            if (!res.ok) {
                console.error("Upload failed:", data);
                const errorInfo = getErrorMessage(data.error || data.details || "Unknown error", file);
                setError(errorInfo.title + ": " + errorInfo.message + " " + errorInfo.suggestion);
                return;
            }

            console.log("Upload success:", data);


            if (data.chunks) {
                console.log("📌 Vectors", data.vectors);
                onSuccess(data.chunks);
            } else {

                onSuccess([data.text || ""]);
            }

            setIsUploaded(true);
        } catch (err: any) {
            console.error("Unexpected upload error:", err);
            const errorInfo = getErrorMessage(err.message || err, file);
            setError(errorInfo.title + ": " + errorInfo.message + " " + errorInfo.suggestion);
        } finally {
            setLoading(false);
        }
    };

    const handleSummarize = () => {
        onSummarize();
    };

    const handleStartChat = () => {
        onStartChat();
    };

    const clearError = () => {
        setError(null);
        setUploadedFile(null);
        setIsUploaded(false);
    };

    return (
        <motion.div
            className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
        >
            <div className="w-full max-w-2xl">
                {/* Header */}
                <motion.div
                    className="text-center mb-12"
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2, duration: 0.6 }}
                >
                    <h1 className="text-4xl font-bold text-gray-800 mb-4">PDF Chat Assistant</h1>
                    <p className="text-lg text-gray-600">Upload your PDF and start exploring its content</p>
                </motion.div>

                {/* Error Alert */}
                <AnimatePresence>
                    {error && (
                        <motion.div
                            initial={{ opacity: 0, y: -10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -10, scale: 0.95 }}
                            className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 shadow-sm"
                        >
                            <div className="flex items-start gap-3">
                                <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                                <div className="flex-1">
                                    <p className="text-red-800 text-sm leading-relaxed">{error}</p>
                                </div>
                                <button
                                    onClick={clearError}
                                    className="text-red-400 hover:text-red-600 transition-colors"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Upload Card */}
                <motion.div
                    className="bg-white rounded-2xl shadow-xl p-8 mb-8"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.4, duration: 0.6 }}
                >
                    {/* File Upload Area */}
                    <div className="relative">
                        <input
                            type="file"
                            accept="application/pdf"
                            onChange={handleUpload}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                            id="pdf-upload"
                            disabled={loading}
                        />

                        <motion.label
                            htmlFor="pdf-upload"
                            className={`
                flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-xl cursor-pointer transition-all duration-300
                ${loading ? 'border-blue-300 bg-blue-50' :
                                    isUploaded ? 'border-green-300 bg-green-50' :
                                        error ? 'border-red-300 bg-red-50' :
                                            'border-gray-300 hover:border-blue-400 hover:bg-blue-50'}
              `}
                            whileHover={{ scale: loading ? 1 : 1.02 }}
                            whileTap={{ scale: loading ? 1 : 0.98 }}
                        >
                            <AnimatePresence mode="wait">
                                {loading ? (
                                    <motion.div
                                        key="loading"
                                        initial={{ opacity: 0, scale: 0.8 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.8 }}
                                        className="flex flex-col items-center"
                                    >
                                        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent mb-4"></div>
                                        <p className="text-blue-600 font-medium">Processing PDF...</p>
                                        <p className="text-sm text-gray-500 mt-1">This may take a few moments</p>
                                    </motion.div>
                                ) : isUploaded ? (
                                    <motion.div
                                        key="success"
                                        initial={{ opacity: 0, scale: 0.8 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.8 }}
                                        className="flex flex-col items-center"
                                    >
                                        <CheckCircle className="h-12 w-12 text-green-500 mb-4" />
                                        <p className="text-green-600 font-medium">PDF Uploaded Successfully!</p>
                                        <p className="text-sm text-gray-600 mt-1">{uploadedFile?.name}</p>
                                    </motion.div>
                                ) : error ? (
                                    <motion.div
                                        key="error"
                                        initial={{ opacity: 0, scale: 0.8 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.8 }}
                                        className="flex flex-col items-center"
                                    >
                                        <AlertTriangle className="h-12 w-12 text-red-500 mb-4" />
                                        <p className="text-red-600 font-medium">Upload Failed</p>
                                        <p className="text-sm text-gray-500 mt-1">Click to try again</p>
                                    </motion.div>
                                ) : (
                                    <motion.div
                                        key="upload"
                                        initial={{ opacity: 0, scale: 0.8 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.8 }}
                                        className="flex flex-col items-center"
                                    >
                                        <div className="relative mb-4">
                                            <FileText className="h-12 w-12 text-gray-400" />
                                            <Paperclip className="h-6 w-6 text-blue-500 absolute -top-1 -right-1" />
                                        </div>
                                        <p className="text-gray-700 font-medium text-lg mb-2">Click to attach PDF</p>
                                        <p className="text-sm text-gray-500">or drag and drop your file here</p>
                                        <p className="text-xs text-gray-400 mt-2">Recommended: PDFs under 3MB</p>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </motion.label>
                    </div>

                    {/* File Info */}
                    <AnimatePresence>
                        {uploadedFile && !loading && !error && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                className="mt-6 p-4 bg-gray-50 rounded-lg border"
                            >
                                <div className="flex items-center gap-3">
                                    <FileText className="h-5 w-5 text-gray-500" />
                                    <span className="text-gray-700 font-medium">{uploadedFile.name}</span>
                                    <span className="text-xs text-gray-500 ml-auto">
                                        {(uploadedFile.size / 1024 / 1024).toFixed(2)} MB
                                    </span>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </motion.div>

                {/* Action Buttons */}
                <AnimatePresence>
                    {isUploaded && !loading && !error && (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 20 }}
                            transition={{ duration: 0.5 }}
                            className="flex gap-4 justify-center"
                        >
                            <motion.button
                                onClick={handleSummarize}
                                className="flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-300"
                                whileHover={{ scale: 1.05, y: -2 }}
                                whileTap={{ scale: 0.95 }}
                            >
                                <BookOpen className="h-5 w-5" />
                                Summarize PDF
                            </motion.button>

                            <motion.button
                                onClick={handleStartChat}
                                className="flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-purple-500 to-purple-600 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-300"
                                whileHover={{ scale: 1.05, y: -2 }}
                                whileTap={{ scale: 0.95 }}
                            >
                                <MessageCircle className="h-5 w-5" />
                                Let's Chat
                            </motion.button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </motion.div>
    );
}