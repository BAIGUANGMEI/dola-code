import { endpointPresets, modelPresetsForService } from "./presets.js";
import { writeProfile } from "./store.js";
import { DEFAULT_CONTEXT_WINDOW_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_PROFILE } from "../constants.js";

export async function runConfigWizard({ cwd, rl, existingConfig = null, defaultScope = "project" }) {
  console.log("\nDola Code setup");
  console.log("This can save a global profile or a project override.\n");

  const scope = await askChoice(rl, "Save scope", ["project", "global"], defaultScope);
  const profile = await askProfile(rl, existingConfig?.profile || existingConfig?.activeProfile);
  const endpoint = await selectEndpoint(rl, existingConfig);
  const model = await selectModel(rl, endpoint.service, existingConfig);
  const apiKey = await askApiKey(rl, existingConfig?.apiKey);
  const contextWindow = await askOptionalNumber(rl, "Context window tokens", existingConfig?.contextWindow || DEFAULT_CONTEXT_WINDOW_TOKENS);
  const maxOutputTokens = await askOptionalNumber(rl, "Max output tokens", existingConfig?.maxOutputTokens || DEFAULT_MAX_OUTPUT_TOKENS);

  const config = writeProfile({
    cwd,
    scope,
    profileName: profile,
    activeProfile: profile,
    profile: {
      provider: "modelark",
      platform: endpoint.platform,
      region: endpoint.region,
      service: endpoint.service,
      protocol: endpoint.protocol,
      baseUrl: endpoint.baseUrl,
      model,
      apiKey,
      contextWindow,
      maxOutputTokens
    }
  });

  console.log(`\nSaved ${scope} profile "${profile}".`);
  console.log(`endpoint: ${endpoint.label}`);
  console.log(`model:    ${model}\n`);

  return config;
}

async function askProfile(rl, existingProfile) {
  const answer = await rl.question(`Profile [${existingProfile || DEFAULT_PROFILE}]: `);
  return answer.trim() || existingProfile || DEFAULT_PROFILE;
}

async function selectEndpoint(rl, existingConfig) {
  console.log("Choose ModelArk endpoint:");
  endpointPresets.forEach((preset, index) => {
    console.log(`  ${index + 1}. ${preset.label}`);
    console.log(`     ${preset.baseUrl || "custom URL"}`);
  });

  const defaultIndex = Math.max(0, endpointPresets.findIndex((preset) => preset.baseUrl === existingConfig?.baseUrl));
  const selected = await askNumber(rl, `Endpoint [${defaultIndex + 1}]`, 1, endpointPresets.length, defaultIndex + 1);
  const preset = endpointPresets[selected - 1];

  if (preset.id !== "custom") {
    return { ...preset };
  }

  const baseUrl = await askRequired(rl, "Custom Base URL");
  const service = await askChoice(rl, "Service", ["model-api", "coding-plan", "custom"], "model-api");
  return {
    ...preset,
    service,
    baseUrl: baseUrl.replace(/\/+$/, "")
  };
}

async function selectModel(rl, service, existingConfig) {
  const presets = modelPresetsForService(service);
  console.log("\nChoose model:");
  presets.forEach((preset, index) => {
    console.log(`  ${index + 1}. ${preset.label}${preset.value ? ` (${preset.value})` : ""}`);
  });

  const defaultIndex = Math.max(0, presets.findIndex((preset) => preset.value === existingConfig?.model));
  const selected = await askNumber(rl, `Model [${defaultIndex + 1}]`, 1, presets.length, defaultIndex + 1);
  const preset = presets[selected - 1];
  if (preset.value) return preset.value;

  return askRequired(rl, "Custom model id");
}

async function askApiKey(rl, existingApiKey) {
  const prompt = existingApiKey
    ? "API key (input visible) [keep existing if blank]"
    : "API key (input visible)";
  const answer = await rl.question(`${prompt}: `);
  const trimmed = answer.trim();
  if (trimmed) return trimmed;
  if (existingApiKey) return existingApiKey;
  console.log("API key is required.");
  return askApiKey(rl, existingApiKey);
}

async function askRequired(rl, label) {
  const answer = await rl.question(`${label}: `);
  const trimmed = answer.trim();
  if (trimmed) return trimmed;
  console.log(`${label} is required.`);
  return askRequired(rl, label);
}

async function askNumber(rl, label, min, max, defaultValue) {
  const answer = await rl.question(`${label}: `);
  const value = answer.trim() ? Number(answer.trim()) : defaultValue;
  if (Number.isInteger(value) && value >= min && value <= max) return value;
  console.log(`Enter a number from ${min} to ${max}.`);
  return askNumber(rl, label, min, max, defaultValue);
}

async function askOptionalNumber(rl, label, defaultValue) {
  const answer = await rl.question(`${label} [${defaultValue}]: `);
  const value = answer.trim() ? Number(answer.trim()) : defaultValue;
  if (Number.isInteger(value) && value > 0) return value;
  console.log(`${label} must be a positive integer.`);
  return askOptionalNumber(rl, label, defaultValue);
}

async function askChoice(rl, label, choices, defaultValue) {
  const answer = await rl.question(`${label} (${choices.join("/")}) [${defaultValue}]: `);
  const value = answer.trim() || defaultValue;
  if (choices.includes(value)) return value;
  console.log(`Choose one of: ${choices.join(", ")}`);
  return askChoice(rl, label, choices, defaultValue);
}
