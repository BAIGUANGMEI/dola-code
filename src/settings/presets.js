export const endpointPresets = [
  {
    id: "byteplus-ap-direct",
    label: "BytePlus International - AP Southeast - Model API",
    platform: "byteplus",
    region: "ap-southeast",
    service: "model-api",
    protocol: "openai",
    baseUrl: "https://ark.ap-southeast.bytepluses.com/api/v3"
  },
  {
    id: "byteplus-eu-direct",
    label: "BytePlus International - EU West - Model API",
    platform: "byteplus",
    region: "eu-west",
    service: "model-api",
    protocol: "openai",
    baseUrl: "https://ark.eu-west.bytepluses.com/api/v3"
  },
  {
    id: "byteplus-ap-coding",
    label: "BytePlus International - AP Southeast - Coding Plan",
    platform: "byteplus",
    region: "ap-southeast",
    service: "coding-plan",
    protocol: "openai",
    baseUrl: "https://ark.ap-southeast.bytepluses.com/api/coding/v3"
  },
  {
    id: "volcengine-cn-direct",
    label: "Volcengine China - Beijing - Model API",
    platform: "volcengine",
    region: "cn-beijing",
    service: "model-api",
    protocol: "openai",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3"
  },
  {
    id: "volcengine-cn-coding",
    label: "Volcengine China - Beijing - Coding Plan",
    platform: "volcengine",
    region: "cn-beijing",
    service: "coding-plan",
    protocol: "openai",
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3"
  },
  {
    id: "custom",
    label: "Custom OpenAI-compatible ModelArk endpoint",
    platform: "custom",
    region: "custom",
    service: "custom",
    protocol: "openai",
    baseUrl: ""
  }
];

export const directModelPresets = [
  {
    id: "seed-2-0-code-preview-260328",
    label: "Dola Code Preview",
    value: "seed-2-0-code-preview-260328"
  },
  {
    id: "seed-2-0-pro-260328",
    label: "Dola Pro",
    value: "seed-2-0-pro-260328"
  },
  {
    id: "seed-2-0-lite-260328",
    label: "Dola Lite",
    value: "seed-2-0-pro-260328"
  },
  {
    id: "custom",
    label: "Custom model or endpoint id from ModelArk console",
    value: ""
  }
];

export const codingPlanModelPresets = [
  {
    id: "seed-2-0-code-preview-260328",
    label: "Dola Code Preview",
    value: "seed-2-0-code-preview-260328"
  },
  {
    id: "seed-2-0-pro-260328",
    label: "Dola Pro",
    value: "seed-2-0-pro-260328"
  },
  {
    id: "seed-2-0-lite-260328",
    label: "Dola Lite",
    value: "seed-2-0-pro-260328"
  },
  {
    id: "custom",
    label: "Custom Coding Plan model",
    value: ""
  }
];

export function modelPresetsForService(service) {
  return service === "coding-plan" ? codingPlanModelPresets : directModelPresets;
}
