import { generateStory } from "../scripts/generate-story.mjs";

export default async function handler(request, response) {
  if (request.method === "OPTIONS") {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.status(204).end();
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({ error: "Use POST" });
    return;
  }

  try {
    response.setHeader("Access-Control-Allow-Origin", "*");
    const story = await generateStory(request.body || {});
    response.status(200).json(story);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
}
