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
