import React, { useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { toggleTheme } from "./features/theme/themeSlice";

import { Sun, Moon, Search, Bell } from 'lucide-react';

const App = () => {
  const [stats] = useState({
    users: 25.6,
    sales: 1200,
    conversion: 14.2,
  });

  const dispatch = useDispatch();

  const theme = useSelector((state) => state.theme.theme);

  return (
    <div data-theme={theme} className="min-h-screen bg-base-300 text-base-content flex flex-col font-sans">

      {/* NAVBAR — glassy */}
      <div className="navbar sticky top-0 z-50 backdrop-blur-xl bg-base-100/60 border-b border-base-content/10 px-4 md:px-8">
        <div className="flex-1">
          <p className="text-xl font-bold text-secondary">
            DevPulse
          </p>
        </div>

        <div className="flex-none gap-2">
          {/* Search */}
          <button className="btn btn-ghost btn-circle">
            <Search size={20} />
          </button>

          {/* Theme toggle — visual only, no logic */}
          <button
            className="btn btn-ghost btn-circle"
            onClick={() => dispatch(toggleTheme())}
          >
            {theme === "dark" ? (
              <Sun size={20} />
            ) : (
              <Moon size={20} />
            )}
          </button>

          {/* Notifications */}
          <button className="btn btn-ghost btn-circle">
            <Bell size={20} />
          </button>

          {/* Avatar */}
          <div className="avatar">
            <div className="w-9 rounded-full ring ring-primary/50 ring-offset-base-100 ring-offset-2">
              <img
                alt="User Avatar"
                src="https://img.daisyui.com/images/stock/photo-1534528741775-53994a69daeb.webp"
              />
            </div>
          </div>
        </div>
      </div>

      {/* MAIN */}
      <main className="flex-1 p-6 md:p-10 max-w-6xl w-full mx-auto space-y-6">

        {/* HERO — glass card */}
        <section className="backdrop-blur-xl bg-base-100/40 border border-base-content/10 rounded-3xl p-8 shadow-lg">
          <h1 className="text-3xl md:text-4xl font-black tracking-tight mb-2">
            System Overview
          </h1>
          <p className="text-base-content/60">
            Welcome back — everything's running smoothly.
          </p>
        </section>

        {/* STATS — glass, minimal */}
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="backdrop-blur-xl bg-base-100/40 border border-base-content/10 rounded-2xl p-6">
            <p className="text-sm text-base-content/50">Total Likes</p>
            <p className="text-3xl font-bold text-primary mt-1">{stats.users}K</p>
          </div>
          <div className="backdrop-blur-xl bg-base-100/40 border border-base-content/10 rounded-2xl p-6">
            <p className="text-sm text-base-content/50">Page Views</p>
            <p className="text-3xl font-bold text-secondary mt-1">2.6M</p>
          </div>
          <div className="backdrop-blur-xl bg-base-100/40 border border-base-content/10 rounded-2xl p-6">
            <p className="text-sm text-base-content/50">Tasks Completed</p>
            <p className="text-3xl font-bold mt-1">{stats.conversion}%</p>
          </div>
        </section>

        {/* CARDS — glass */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { title: "Analytics Engine", badge: "Active", color: "accent", progress: 70 },
            { title: "Database Sync", badge: "Syncing", color: "secondary", progress: 45 },
            { title: "API Security", badge: "Protected", color: "info", progress: 95 },
          ].map((card) => (
            <div
              key={card.title}
              className="backdrop-blur-xl bg-base-100/40 border border-base-content/10 rounded-2xl p-6 hover:bg-base-100/60 transition-colors"
            >
              <div className="flex justify-between items-center mb-2">
                <h2 className="font-semibold">{card.title}</h2>
                <span className={`badge badge-${card.color} badge-sm`}>{card.badge}</span>
              </div>
              <progress
                className={`progress progress-${card.color} w-full`}
                value={card.progress}
                max="100"
              ></progress>
            </div>
          ))}
        </section>

      </main>

      {/* FOOTER */}
      <footer className="footer footer-center p-4 text-base-content/50 text-sm">
        <p>© 2026 DevPulse</p>
      </footer>
    </div>
  );
};

export default App;