import { execFileSync } from "node:child_process";
import path from "node:path";

export function installedChromeVersion(chromePath, { platform = process.platform, execFile = execFileSync } = {}) {
  // macOS Chrome can keep --version alive as a GUI process. Reading signed app
  // metadata avoids launching Chrome just to select the matching user agent.
  const output = platform === "darwin"
    ? execFile("/usr/bin/plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-",
      path.resolve(path.dirname(chromePath), "..", "Info.plist")], { encoding: "utf8", timeout: 5_000 })
    : execFile(chromePath, ["--version"], { encoding: "utf8", timeout: 5_000 });
  const version = platform === "darwin"
    ? String(output).trim().match(/^\d+(?:\.\d+){3}$/)?.[0]
    : String(output).match(/\b(\d+(?:\.\d+){3})\b/)?.[1];
  if (!version) throw new Error("Installed Google Chrome version could not be determined.");
  return version;
}

const FORBIDDEN_EXACT = new Set([
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-site-isolation-trials",
  "--disable-web-security",
  "--allow-insecure-localhost",
  "--reduce-security-for-testing",
]);

export function isUnsafeChromeArgument(argument) {
  const value = String(argument || "");
  if (FORBIDDEN_EXACT.has(value)) return true;
  if (value.startsWith("--ignore-certificate-errors") || value.startsWith("--ignore-certifcate-errors")) return true;
  if (value.startsWith("--disable-features=") && /(?:^|,)(?:site-per-process|IsolateSandboxedIframes)(?:,|$)/i.test(value.slice(19))) {
    return true;
  }
  return false;
}

export function hardenChromeLaunch({ puppeteerCore, openWaPuppeteerConfig }) {
  const configured = Array.isArray(openWaPuppeteerConfig?.puppeteerConfig?.chromiumArgs)
    ? openWaPuppeteerConfig.puppeteerConfig.chromiumArgs
    : [];
  const safeConfigured = configured.filter((argument) => !isUnsafeChromeArgument(argument));
  openWaPuppeteerConfig.puppeteerConfig.chromiumArgs = safeConfigured;

  const defaultArguments = puppeteerCore.defaultArgs({ headless: true });
  const ignoreDefaultArgs = defaultArguments.filter((argument) => isUnsafeChromeArgument(argument));
  return { chromiumArgs: [], ignoreDefaultArgs };
}
