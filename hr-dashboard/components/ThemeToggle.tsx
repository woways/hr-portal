"use client";
import { useState, useEffect } from "react";
import { Sun, Moon } from "lucide-react";

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    if (next) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
    setDark(next);
  }

  if (!mounted) return <div className="w-[68px] h-8" />;

  return (
    <button
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="relative flex items-center w-[68px] h-8 rounded-full border transition-colors duration-300 bg-[#EDE9FF] border-[#4F3CC9]/20 dark:bg-[#1e1e38] dark:border-purple-700/40"
    >
      <Sun
        size={14}
        className={`absolute left-2.5 transition-all duration-300 ${dark ? "text-gray-500 opacity-40" : "text-[#4F3CC9]"}`}
      />
      <Moon
        size={14}
        className={`absolute right-2.5 transition-all duration-300 ${dark ? "text-purple-300" : "text-gray-400 opacity-40"}`}
      />
      <span
        className={`absolute top-[3px] w-[26px] h-[26px] rounded-full shadow transition-all duration-300 ${
          dark ? "left-[37px] bg-[#4F3CC9]" : "left-[3px] bg-white"
        }`}
      />
    </button>
  );
}
