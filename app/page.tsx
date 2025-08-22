"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Upload from "./components/Upload";
import Chat from "./components/ChatUI";

export default function MainPage() {
  const [chunks, setChunks] = useState<string[]>([]);
  const [showChat, setShowChat] = useState(false);
  const [initialMessage, setInitialMessage] = useState("");

  const handleUploadSuccess = (uploadedChunks: string[]) => {
    setChunks(uploadedChunks);
  };

  const handleSummarize = () => {
    setInitialMessage("Please provide a comprehensive summary of this PDF document.");
    setShowChat(true);
  };

  const handleStartChat = () => {
    setInitialMessage("What would you like to know about this PDF?");
    setShowChat(true);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex h-screen">
        {/* Upload Section */}
        <motion.div
          className={showChat ? "w-1/2" : "w-full"}
          initial={false}
          animate={{
            width: showChat ? "50%" : "100%",
          }}
          transition={{
            duration: 0.8,
            ease: [0.25, 0.46, 0.45, 0.94]
          }}
        >
          <Upload
            onSuccess={handleUploadSuccess}
            onSummarize={handleSummarize}
            onStartChat={handleStartChat}
          />
        </motion.div>

        {/* Chat Section */}
        <AnimatePresence>
          {showChat && (
            <motion.div
              className="w-1/2 border-l border-gray-200"
              initial={{
                x: "100%",
                opacity: 0
              }}
              animate={{
                x: 0,
                opacity: 1
              }}
              exit={{
                x: "100%",
                opacity: 0
              }}
              transition={{
                duration: 0.8,
                ease: [0.25, 0.46, 0.45, 0.94]
              }}
            >
              <Chat
                chunks={chunks}
                initialMessage={initialMessage}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}