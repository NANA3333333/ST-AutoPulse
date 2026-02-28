const path = require('path');
const fs = require('fs');
const { LocalIndex } = require('vectra');
const { callLLM } = require('./llm');
const db = require('./db');

// Dynamic import for transformers.js
let pipeline = null;
let extractionDisabled = false;

async function getExtractor() {
    if (extractionDisabled) return null;
    if (!pipeline) {
        try {
            const transformers = await import('@xenova/transformers');
            pipeline = await transformers.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        } catch (e) {
            console.error('[Memory] Xenova/ONNX initialization failed. Disabling local embeddings. Error:', e.message);
            extractionDisabled = true;
            return null;
        }
    }
    return pipeline;
}

async function getEmbedding(text) {
    const extractor = await getExtractor();
    if (!extractor) {
        // Return a zero-vector if local embeddings are broken
        return Array.from({ length: 384 }, () => 0);
    }
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
}

// Memory vector indices cache: CharacterID -> LocalIndex
const indices = new Map();

async function getVectorIndex(characterId) {
    if (indices.has(characterId)) {
        return indices.get(characterId);
    }
    const dir = path.join(__dirname, '..', 'data', 'vectors', characterId);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const index = new LocalIndex(path.join(dir, 'index.json'));
    // Create if not exists
    const isCreated = await index.isIndexCreated();
    if (!isCreated) {
        await index.createIndex({
            version: 1,
            deleteConfig: { enabled: false }, // Simple config
            dimension: 384 // Dimension of all-MiniLM-L6-v2
        });
    }
    indices.set(characterId, index);
    return index;
}

async function wipeIndex(characterId) {
    indices.delete(characterId);
    const dir = path.join(__dirname, '..', 'data', 'vectors', characterId);
    if (fs.existsSync(dir)) {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch (e) {
            console.error(`[Memory] Failed to physically wipe vector dir for ${characterId}:`, e.message);
        }
    }
}

/**
 * Searches for relevant memories based on a query text.
 */
async function searchMemories(characterId, queryText, limit = 5) {
    try {
        const index = await getVectorIndex(characterId);
        const queryEmbedding = await getEmbedding(queryText);

        const results = await index.queryItems(queryEmbedding, limit);
        // Map results back to sqlite memory rows using metadata.id
        const memories = [];
        for (const res of results) {
            // Threshold filtering (e.g., > 0.5 similarity)
            if (res.score > 0.5 && res.item.metadata && res.item.metadata.memory_id) {
                const memRow = db.getMemory(res.item.metadata.memory_id);
                if (memRow) {
                    memories.push(memRow);
                }
            }
        }
        return memories;
    } catch (e) {
        console.error(`[Memory] Search failed for ${characterId}:`, e.message);
        return [];
    }
}

/**
 * Uses a small LLM to extract memories from recent conversation context.
 */
async function extractMemoryFromContext(character, recentMessages, groupId = null) {
    if (!character.memory_api_endpoint || !character.memory_api_key || !character.memory_model_name) {
        // Skip memory extraction if memory AI is not configured
        return null;
    }

    const contextText = recentMessages.map(m => `${m.role === 'user' ? 'User' : character.name}: ${m.content}`).join('\n');

    const extractionPrompt = `
You are a memory extraction assistant. Analyze the following recent conversation snippet between User and ${character.name}.
Identify if there are any new, significant facts, events, or relationship changes that should be remembered long-term.
Return a structured JSON object. Focus on extracting WHAT happened, WHEN, WHERE, and WHO.

Conversation:
---
${contextText}
---

Output exactly in this JSON format (and nothing else):
{
    "action": "add" | "update" | "none",
    "time": "...",
    "location": "...",
    "people": "...",
    "event": "...",
    "relationships": "...",
    "items": "...",
    "importance": <number 1-10>
}
If there is nothing new or important, return "action": "none".
`;

    try {
        const responseText = await callLLM({
            endpoint: character.memory_api_endpoint,
            key: character.memory_api_key,
            model: character.memory_model_name,
            messages: [
                { role: 'system', content: 'You extract structured JSON facts.' },
                { role: 'user', content: extractionPrompt }
            ],
            maxTokens: 300,
            temperature: 0.1
        });

        // Parse JSON safely
        const startIdx = responseText.indexOf('{');
        const endIdx = responseText.lastIndexOf('}');
        if (startIdx !== -1 && endIdx !== -1) {
            const jsonText = responseText.slice(startIdx, endIdx + 1);
            const parsed = JSON.parse(jsonText);

            if (parsed.action === 'add' || parsed.action === 'update') {
                await saveExtractedMemory(character.id, parsed, groupId);
                return parsed;
            }
        }
    } catch (e) {
        console.error(`[Memory] Extraction failed for ${character.id}:`, e.message);
    }
    return null;
}

async function saveExtractedMemory(characterId, memoryData, groupId = null) {
    try {
        // 1. Generate embedding for the event text
        const textToEmbed = `${memoryData.event} People: ${memoryData.people || ''}. Items: ${memoryData.items || ''}.`;
        const embeddingArray = await getEmbedding(textToEmbed);

        // Convert JS array to Buffer for SQLite storage (optional, vectra uses its own file)
        const embeddingBuffer = Buffer.from(new Float32Array(embeddingArray).buffer);
        memoryData.embedding = embeddingBuffer;

        // 2. Save to SQLite (with optional group_id for cleanup)
        const memoryId = db.addMemory(characterId, memoryData, groupId);

        // 3. Save to Vectra store
        const index = await getVectorIndex(characterId);
        await index.insertItem({
            vector: embeddingArray,
            metadata: { memory_id: memoryId }
        });

        console.log(`[Memory] Stored new memory for ${characterId}: ${memoryData.event}`);
    } catch (e) {
        console.error(`[Memory] Save failed for ${characterId}:`, e.message);
    }
}

module.exports = {
    searchMemories,
    extractMemoryFromContext,
    saveExtractedMemory,
    wipeIndex
};
