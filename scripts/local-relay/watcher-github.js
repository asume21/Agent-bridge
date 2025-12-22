/* eslint-env node */
/*
  GitHub-aware relay watcher for agent-to-agent notifications.
  
  Watches BOTH:
  1. Local .handoff folder (for Cascade notifications)
  2. GitHub repo (for Replit Agent notifications)
  
  When either agent creates a flag, you get a desktop toast + clipboard prompt.
  
  Run: node scripts/local-relay/watcher-github.js
*/

import fs from "fs/promises";
import { watch } from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";

// Configuration
const GITHUB_REPO = "asume21/Agent-bridge";
const GITHUB_BRANCH = "main";
const POLL_GITHUB_MS = 10000; // Check GitHub every 10 seconds
const LOCAL_FLAG_DIR = path.resolve(process.cwd(), ".handoff");

const TARGETS = [
  { name: "notify-cascade", agent: "Cascade", notifyFor: "Replit" },
  { name: "notify-replit", agent: "Replit", notifyFor: "Cascade" },
];

const debounceMs = 750;
const localPollMs = 5000;
const lastHandled = new Map();
const lastGitHubSha = new Map();
const timers = new Map();

async function ensureDir() {
  await fs.mkdir(LOCAL_FLAG_DIR, { recursive: true });
}

async function notifyDesktop(message) {
  try {
    const mod = await import("node-notifier");
    const notifier = mod.default || mod;
    notifier.notify({ title: "Agent Relay", message, wait: false });
  } catch (err) {
    console.log(`[notify-fallback] ${message}`);
  }
}

async function copyClipboard(text) {
  try {
    const mod = await import("clipboardy");
    const clip = mod.default || mod;
    await clip.write(text);
    return true;
  } catch (err) {
    const platform = os.platform();
    if (platform === "win32") {
      await execCommand("powershell", ["-NoProfile", "-Command", `Set-Clipboard -Value "${text.replace(/"/g, '\\"')}"`]);
      return true;
    }
    if (platform === "darwin") {
      await execCommand("pbcopy", [], text);
      return true;
    }
    await execCommand("sh", ["-c", `printf '%s' "${text.replace(/"/g, '\\"')}" | xclip -selection clipboard`]);
    return true;
  }
}

function execCommand(cmd, args, stdin) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, (err) => {
      if (err) return reject(err);
      resolve(undefined);
    });
    if (stdin) {
      child.stdin?.write(stdin);
      child.stdin?.end();
    }
  });
}

async function triggerNotification(fromAgent, context) {
  const prompt = context
    ? `${fromAgent} has a message for you. Check .ai/dialogue.json and .handoff/collab.json, then respond to continue the conversation. Context: ${context}`
    : `${fromAgent} has a message for you. Check .ai/dialogue.json and .handoff/collab.json, then respond to continue the conversation.`;

  const toastMsg = `Message from ${fromAgent} - paste to continue`;
  await copyClipboard(prompt).catch(() => {});
  await notifyDesktop(toastMsg);
  
  console.log("");
  console.log("========================================");
  console.log(`${fromAgent.toUpperCase()}: CHECK MESSAGES!`);
  console.log("========================================");
  console.log(`[clipboard] ${prompt}`);
  console.log("");
}

// ============ LOCAL FILE WATCHING ============

async function handleLocalFlag(target) {
  const filePath = path.join(LOCAL_FLAG_DIR, target.name);
  try {
    const stat = await fs.stat(filePath);
    const prev = lastHandled.get(filePath) || 0;
    if (stat.mtimeMs <= prev) return;
    lastHandled.set(filePath, stat.mtimeMs);

    let context = "";
    try {
      context = (await fs.readFile(filePath, "utf-8")).trim();
    } catch {}

    await triggerNotification(target.agent, context);
  } catch (err) {
    if (err?.code === "ENOENT") return;
    console.error(`[local] error:`, err.message);
  }
}

function debounceLocalHandle(target) {
  const key = target.name;
  if (timers.has(key)) clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      handleLocalFlag(target);
    }, debounceMs),
  );
}

function startLocalWatcher() {
  watch(LOCAL_FLAG_DIR, { persistent: true }, (eventType, filename) => {
    if (!filename) return;
    const target = TARGETS.find((t) => t.name === filename.toString());
    if (!target) return;
    debounceLocalHandle(target);
  });

  setInterval(() => TARGETS.forEach(handleLocalFlag), localPollMs);
  console.log(`[local] watching ${LOCAL_FLAG_DIR}`);
}

// ============ GITHUB POLLING ============

async function fetchGitHubFile(filePath) {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/.handoff/${filePath}?ref=${GITHUB_BRANCH}`;
  try {
    const response = await fetch(url, {
      headers: { "Accept": "application/vnd.github.v3+json" }
    });
    if (!response.ok) return null;
    const data = await response.json();
    return {
      sha: data.sha,
      content: data.content ? Buffer.from(data.content, "base64").toString("utf-8").trim() : ""
    };
  } catch (err) {
    return null;
  }
}

async function pollGitHub() {
  for (const target of TARGETS) {
    const result = await fetchGitHubFile(target.name);
    if (!result) continue;

    const prevSha = lastGitHubSha.get(target.name);
    if (prevSha === result.sha) continue;

    // New or changed file!
    lastGitHubSha.set(target.name, result.sha);
    
    // Skip first detection (just record current state)
    if (!prevSha) {
      console.log(`[github] tracking ${target.name} (sha: ${result.sha.slice(0, 7)})`);
      continue;
    }

    console.log(`[github] new flag detected: ${target.name}`);
    await triggerNotification(target.agent, result.content);
  }
}

function startGitHubPoller() {
  console.log(`[github] polling ${GITHUB_REPO} every ${POLL_GITHUB_MS / 1000}s`);
  pollGitHub(); // Initial check to record current state
  setInterval(pollGitHub, POLL_GITHUB_MS);
}

// ============ MAIN ============

async function main() {
  console.log("");
  console.log("=== AGENT RELAY WATCHER ===");
  console.log("Watching for notifications from both agents...");
  console.log("");

  await ensureDir();
  
  // Start both watchers
  startLocalWatcher();
  startGitHubPoller();

  console.log("");
  console.log("Ready! Waiting for agent notifications...");
  console.log("- Cascade: creates local .handoff/notify-* files");
  console.log("- Replit:  pushes to GitHub, detected via API");
  console.log("");
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
