"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  feedbackGiven?: boolean;
}

const SESSION_KEY = "faivr-support-session";
const OPEN_KEY = "faivr-support-open";
const VISITED_KEY = "faivr-support-visited";
const GREETING: Message = {
  id: "greeting",
  role: "assistant",
  content:
    "👋 Hey! I'm the FAIVR support agent. I can help you with:\n\n• Agent registration & onboarding\n• Hiring agents & escrow payments\n• Wallet connection & Base network\n• Verification process\n• The Genesis Agent Program\n• ERC-8004 standard\n\nWhat would you like to know?",
};

function getSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = sessionStorage.getItem("faivr-support-sid");
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem("faivr-support-sid", id);
  }
  return id;
}

export default function SupportChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [showPulse, setShowPulse] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasLoadedPersistedState = useRef(false);

  // Load persisted state
  useEffect(() => {
    const savedOpen = localStorage.getItem(OPEN_KEY);
    const savedMessages = sessionStorage.getItem(SESSION_KEY);
    const firstVisit = !localStorage.getItem(VISITED_KEY);
    let persistedMessages: Message[] = [];
    try {
      persistedMessages = savedMessages ? JSON.parse(savedMessages) : [];
    } catch {}

    const frameId = window.requestAnimationFrame(() => {
      hasLoadedPersistedState.current = true;
      if (savedOpen === "true") setIsOpen(true);
      if (persistedMessages.length > 0) {
        setMessages(persistedMessages);
      } else if (savedOpen === "true") {
        setMessages([GREETING]);
      }
      if (firstVisit) setShowPulse(true);
    });
    if (firstVisit) localStorage.setItem(VISITED_KEY, "1");

    return () => window.cancelAnimationFrame(frameId);
  }, []);

  // Persist messages
  useEffect(() => {
    if (messages.length > 0) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(messages));
    }
  }, [messages]);

  // Persist open state
  useEffect(() => {
    if (!hasLoadedPersistedState.current) return;
    localStorage.setItem(OPEN_KEY, String(isOpen));
  }, [isOpen]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 300);
  }, [isOpen]);

  const openChat = useCallback(() => {
    setMessages((current) => (current.length > 0 ? current : [GREETING]));
    setShowPulse(false);
    setIsOpen(true);
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isTyping) return;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    try {
      const history = messages
        .filter((m) => m.id !== "greeting")
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/support/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });

      const data = await res.json();
      const reply = data.reply || data.error || "Sorry, something went wrong.";

      const assistantMsg: Message = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: reply,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: "assistant",
          content: "Sorry, I couldn't process that. Please try again.",
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  }, [input, isTyping, messages]);

  const sendFeedback = async (msgId: string, helpful: boolean) => {
    const msg = messages.find((m) => m.id === msgId);
    if (!msg) return;

    // Find the user question that preceded this answer
    const idx = messages.findIndex((m) => m.id === msgId);
    const userMsg = messages
      .slice(0, idx)
      .reverse()
      .find((m) => m.role === "user");

    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, feedbackGiven: true } : m))
    );

    try {
      await fetch("/api/support/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: msgId,
          question: userMsg?.content || "",
          answer: msg.content,
          helpful,
          sessionId: getSessionId(),
        }),
      });
    } catch {}
  };

  return (
    <>
      {/* Floating Button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={openChat}
            className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-500/25 transition-shadow hover:shadow-xl hover:shadow-violet-500/30"
            aria-label="Open support chat"
          >
            {showPulse && (
              <span className="absolute inset-0 animate-ping rounded-full bg-violet-500 opacity-40" />
            )}
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chat Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed bottom-6 right-6 z-50 flex w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-black/50 sm:bottom-6 sm:right-6"
            style={{
              height: "min(600px, calc(100vh - 6rem))",
              background:
                "linear-gradient(145deg, rgba(15,15,25,0.97) 0%, rgba(10,10,18,0.99) 100%)",
              backdropFilter: "blur(20px)",
            }}
          >
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-white/10 bg-gradient-to-r from-violet-600/10 to-indigo-600/10 px-4 py-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 text-sm">
                🤖
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-white">
                  FAIVR Support
                </div>
                <div className="text-xs text-white/50">
                  Ask about the platform
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-white/5 hover:text-white/80"
                aria-label="Close chat"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 scrollbar-thin">
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div className="flex flex-col gap-1 max-w-[85%]">
                    <div
                      className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                        msg.role === "user"
                          ? "bg-gradient-to-br from-violet-600 to-indigo-600 text-white rounded-br-md"
                          : "bg-white/[0.06] text-white/90 border border-white/[0.06] rounded-bl-md"
                      }`}
                    >
                      {msg.content}
                    </div>
                    {/* Feedback buttons for assistant messages */}
                    {msg.role === "assistant" &&
                      msg.id !== "greeting" &&
                      !msg.feedbackGiven && (
                        <div className="flex gap-1 ml-1">
                          <button
                            onClick={() => sendFeedback(msg.id, true)}
                            className="text-xs text-white/25 hover:text-green-400 transition-colors p-0.5"
                            title="Helpful"
                          >
                            👍
                          </button>
                          <button
                            onClick={() => sendFeedback(msg.id, false)}
                            className="text-xs text-white/25 hover:text-red-400 transition-colors p-0.5"
                            title="Not helpful"
                          >
                            👎
                          </button>
                        </div>
                      )}
                    {msg.feedbackGiven && (
                      <div className="text-[10px] text-white/20 ml-1">
                        Thanks for the feedback!
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}

              {/* Typing indicator */}
              {isTyping && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex justify-start"
                >
                  <div className="rounded-2xl rounded-bl-md bg-white/[0.06] border border-white/[0.06] px-4 py-3">
                    <div className="flex gap-1">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="inline-block h-1.5 w-1.5 rounded-full bg-white/40 animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }}
                        />
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-white/10 px-3 py-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendMessage();
                }}
                className="flex gap-2"
              >
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask about FAIVR..."
                  className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20 transition-all"
                  disabled={isTyping}
                  maxLength={500}
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isTyping}
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white transition-opacity disabled:opacity-30 hover:opacity-90"
                  aria-label="Send message"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2L7 9M14 2l-5 12-2-5-5-2 12-5z" />
                  </svg>
                </button>
              </form>
              <div className="mt-2 text-center text-[10px] text-white/15">
                Powered by FAIVR
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
