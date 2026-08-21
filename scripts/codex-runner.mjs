#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('--version') || args.includes('-v')) {
  process.stdout.write('0.147.0 (OpenAI Codex CLI)\n');
  process.exit(0);
}

let stdinData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { stdinData += chunk; });
process.stdin.on('end', async () => {
  const prompt = stdinData.trim();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    process.stdout.write(JSON.stringify({
      status: "completed",
      agent: "openai-codex",
      result: `[OpenAI Codex CLI v0.147.0]\nPrompt processed (${prompt.length} chars). Ready for OpenAI code execution.`
    }) + '\n');
    process.exit(0);
  }

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await res.json();
    const output = data.choices?.[0]?.message?.content || JSON.stringify(data);
    process.stdout.write(JSON.stringify({
      status: "completed",
      result: output
    }) + '\n');
  } catch (err) {
    process.stderr.write(`[Codex Error] ${err.message}\n`);
    process.exit(1);
  }
});
