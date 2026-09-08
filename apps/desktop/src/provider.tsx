import type { Provider } from "@runlit/protocol";
import claudeCodeIcon from "./assets/providers/claude-code.png";
import codexIcon from "./assets/providers/codex.png";
import cursorIcon from "./assets/providers/cursor.png";
import geminiCliIcon from "./assets/providers/gemini-cli.png";
import githubCopilotIcon from "./assets/providers/github-copilot.png";
import opencodeIcon from "./assets/providers/opencode.png";
import terminalIcon from "./assets/providers/terminal.png";
import windsurfIcon from "./assets/providers/windsurf.png";
import workbuddyIcon from "./assets/providers/workbuddy.svg";

export const providerMeta: Record<string, { name: string; icon: string }> = {
  codex: { name: "Codex", icon: codexIcon },
  claude_code: { name: "Claude Code", icon: claudeCodeIcon },
  cursor: { name: "Cursor", icon: cursorIcon },
  gemini_cli: { name: "Gemini CLI", icon: geminiCliIcon },
  github_copilot: { name: "GitHub Copilot", icon: githubCopilotIcon },
  opencode: { name: "OpenCode", icon: opencodeIcon },
  windsurf: { name: "Windsurf", icon: windsurfIcon },
  workbuddy: { name: "WorkBuddy AI", icon: workbuddyIcon },
  generic_cli: { name: "Terminal", icon: terminalIcon },
};

export function getProviderMeta(provider: Provider) {
  return providerMeta[provider] ?? {
    name: provider.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    icon: terminalIcon,
  };
}

export function ProviderMark({ provider }: { provider: Provider }) {
  const meta = getProviderMeta(provider);
  return <img className={`provider-mark provider-${provider}`} src={meta.icon} alt={meta.name} draggable={false} />;
}
