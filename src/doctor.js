import { truncate } from "./utils/text.js";
import { formatUsage } from "./utils/tokens.js";

export async function doctor({ client, printConfig }) {
  if (!client.apiKey) {
    console.log("API key is missing. Run /init to save one in .dola-code/config.json.");
    return;
  }

  console.log("Checking BytePlus ModelArk connection...");
  printConfig();

  try {
    const { message, usage, elapsedMs } = await client.chatCompletions({
      messages: [{ role: "user", content: "Reply with OK." }],
      temperature: 0
    });
    const content = message.content ?? "";
    console.log(`Connection OK. Model replied: ${content || "[empty content]"}`);
    console.log(`usage: ${formatUsage(usage)} elapsed=${elapsedMs}ms`);
  } catch (error) {
    console.log(`Connection failed: ${truncate(error.message, 4000)}`);
  }
}
