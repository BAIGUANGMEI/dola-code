import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  CONFIG_DIR,
  CONFIG_FILE,
  CONFIG_SCHEMA_VERSION,
  DEFAULT_BASE_URL,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_MODEL,
  DEFAULT_PROFILE
} from "../constants.js";

export function configPathForCwd(cwd) {
  return join(cwd, CONFIG_DIR, CONFIG_FILE);
}

export function globalConfigPath() {
  return join(homedir(), CONFIG_DIR, CONFIG_FILE);
}

export function readLocalConfig(cwd) {
  return readConfigFile(configPathForCwd(cwd));
}

export function readGlobalConfig() {
  return readConfigFile(globalConfigPath());
}

export function resolveStoredConfig({ cwd, profileName = "" }) {
  const globalConfig = readGlobalConfig();
  const localConfig = readLocalConfig(cwd);
  const activeProfile = profileName || localConfig?.activeProfile || globalConfig?.activeProfile || DEFAULT_PROFILE;
  const defaults = defaultProfile();
  const globalProfile = profileFromConfig(globalConfig, activeProfile);
  const localProfile = profileFromConfig(localConfig, activeProfile);
  const merged = normalizeProfile({
    ...defaults,
    ...definedOnly(globalProfile),
    ...definedOnly(localProfile)
  });

  return {
    ...merged,
    activeProfile,
    profile: activeProfile,
    configSource: sourceLabel({ globalConfig, localConfig, activeProfile }),
    hasGlobalConfig: Boolean(globalConfig),
    hasLocalConfig: Boolean(localConfig),
    globalConfig,
    localConfig
  };
}

export function writeLocalConfig(cwd, config) {
  return writeProfileConfig({
    path: configPathForCwd(cwd),
    profileName: config.profile || config.activeProfile || DEFAULT_PROFILE,
    profile: config,
    activeProfile: config.activeProfile || config.profile || DEFAULT_PROFILE
  });
}

export function writeGlobalConfig(config) {
  return writeProfileConfig({
    path: globalConfigPath(),
    profileName: config.profile || config.activeProfile || DEFAULT_PROFILE,
    profile: config,
    activeProfile: config.activeProfile || config.profile || DEFAULT_PROFILE
  });
}

export function writeProfile({ cwd, scope = "project", profileName, profile, activeProfile = profileName }) {
  return writeProfileConfig({
    path: scope === "global" ? globalConfigPath() : configPathForCwd(cwd),
    profileName,
    profile,
    activeProfile
  });
}

export function setActiveProfile({ cwd, scope = "project", profileName }) {
  const path = scope === "global" ? globalConfigPath() : configPathForCwd(cwd);
  const existing = readConfigFile(path) || emptyConfigFile();
  const next = {
    ...existing,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    activeProfile: profileName,
    updatedAt: new Date().toISOString()
  };
  if (!next.createdAt) next.createdAt = next.updatedAt;
  writeConfigFile(path, next);
  return next;
}

export function listProfiles({ cwd }) {
  const globalConfig = readGlobalConfig();
  const localConfig = readLocalConfig(cwd);
  const names = new Set([
    ...Object.keys(globalConfig?.profiles || {}),
    ...Object.keys(localConfig?.profiles || {})
  ]);
  if (!names.size) names.add(DEFAULT_PROFILE);
  return [...names].sort().map((name) => ({
    name,
    global: Boolean(globalConfig?.profiles?.[name]),
    project: Boolean(localConfig?.profiles?.[name])
  }));
}

export function persistModelSelection({ cwd, profileName, model, preferLocal = true }) {
  const localConfig = readLocalConfig(cwd);
  const scope = preferLocal && localConfig ? "project" : "global";
  const current = resolveStoredConfig({ cwd, profileName });
  return writeProfile({
    cwd,
    scope,
    profileName,
    activeProfile: profileName,
    profile: {
      ...current,
      model
    }
  });
}

function readConfigFile(path) {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  return normalizeConfigFile(JSON.parse(raw));
}

function writeProfileConfig({ path, profileName, profile, activeProfile }) {
  const existing = readConfigFile(path) || emptyConfigFile();
  const normalizedProfile = normalizeProfile(profile);
  const now = new Date().toISOString();
  const next = {
    ...existing,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    activeProfile,
    profiles: {
      ...(existing.profiles || {}),
      [profileName]: {
        ...(existing.profiles?.[profileName] || {}),
        ...normalizedProfile,
        updatedAt: now,
        createdAt: existing.profiles?.[profileName]?.createdAt || normalizedProfile.createdAt || now
      }
    },
    updatedAt: now,
    createdAt: existing.createdAt || now
  };
  writeConfigFile(path, next);
  return {
    ...next.profiles[profileName],
    activeProfile,
    profile: profileName
  };
}

function writeConfigFile(path, config) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function normalizeConfigFile(config) {
  if (!config) return null;
  if (config.profiles) {
    return {
      schemaVersion: config.schemaVersion || CONFIG_SCHEMA_VERSION,
      activeProfile: config.activeProfile || DEFAULT_PROFILE,
      profiles: Object.fromEntries(
        Object.entries(config.profiles).map(([name, profile]) => [name, normalizeStoredProfile(profile)])
      ),
      createdAt: config.createdAt,
      updatedAt: config.updatedAt
    };
  }

  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    activeProfile: config.profile || config.activeProfile || DEFAULT_PROFILE,
    profiles: {
      [config.profile || config.activeProfile || DEFAULT_PROFILE]: normalizeStoredProfile(config)
    },
    createdAt: config.createdAt,
    updatedAt: config.updatedAt
  };
}

function profileFromConfig(config, profileName) {
  if (!config?.profiles) return null;
  return config.profiles[profileName] || null;
}

function normalizeProfile(config = {}) {
  return {
    provider: config.provider || "modelark",
    platform: config.platform || "byteplus",
    region: config.region || "ap-southeast",
    service: config.service || "model-api",
    protocol: config.protocol || "openai",
    baseUrl: (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model: config.model || DEFAULT_MODEL,
    apiKey: config.apiKey || "",
    contextWindow: normalizePositiveInt(config.contextWindow, DEFAULT_CONTEXT_WINDOW_TOKENS),
    maxOutputTokens: normalizePositiveInt(config.maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS),
    createdAt: config.createdAt,
    updatedAt: config.updatedAt
  };
}

function normalizeStoredProfile(config = {}) {
  const profile = {};
  if (config.provider !== undefined) profile.provider = config.provider;
  if (config.platform !== undefined) profile.platform = config.platform;
  if (config.region !== undefined) profile.region = config.region;
  if (config.service !== undefined) profile.service = config.service;
  if (config.protocol !== undefined) profile.protocol = config.protocol;
  if (config.baseUrl !== undefined) profile.baseUrl = String(config.baseUrl).replace(/\/+$/, "");
  if (config.model !== undefined) profile.model = config.model;
  if (config.apiKey !== undefined) profile.apiKey = config.apiKey;
  if (config.contextWindow !== undefined) profile.contextWindow = normalizePositiveInt(config.contextWindow, undefined);
  if (config.maxOutputTokens !== undefined) profile.maxOutputTokens = normalizePositiveInt(config.maxOutputTokens, undefined);
  if (config.createdAt !== undefined) profile.createdAt = config.createdAt;
  if (config.updatedAt !== undefined) profile.updatedAt = config.updatedAt;
  return profile;
}

function defaultProfile() {
  return normalizeProfile({});
}

function emptyConfigFile() {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    activeProfile: DEFAULT_PROFILE,
    profiles: {}
  };
}

function normalizePositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function definedOnly(value = {}) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ""));
}

function sourceLabel({ globalConfig, localConfig, activeProfile }) {
  const parts = [];
  if (globalConfig?.profiles?.[activeProfile]) parts.push("global-json");
  if (localConfig?.profiles?.[activeProfile]) parts.push("project-json");
  return parts.length ? parts.join("+") : "defaults";
}
