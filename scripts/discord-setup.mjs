// One-off Discord server setup for Cabin Visuals.
// Usage (PowerShell):
//   $env:DISCORD_BOT_TOKEN = "<bot token>"
//   $env:DISCORD_GUILD_ID  = "<server id>"
//   node scripts/discord-setup.mjs
//
// Safe to re-run: existing roles/categories/channels (matched by name) are
// left alone, so you can tweak CONFIG and run again to add new things.

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!TOKEN || !GUILD_ID) {
  console.error('Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID env vars first.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Edit this block to change the server layout.
// ---------------------------------------------------------------------------

const CONFIG = {
  roles: [
    { name: 'Developer', color: 0xf5a623, hoist: true },
    { name: 'Pro', color: 0x7b61ff, hoist: true },
  ],

  categories: [
    {
      name: 'START HERE',
      channels: [
        {
          name: 'welcome',
          topic: 'What Cabin Visuals is and how this server works',
          readOnly: true,
          // {#channel-name} placeholders become real clickable channel links.
          messages: [
            [
              '**Welcome to Cabin Visuals!**',
              '',
              'Cabin Visuals turns your music into visuals — sequence instruments on a timeline like a DAW and export video.',
              '',
              '**Channels**',
              '- {#general} — hang out, talk visual music',
              '- {#showcase} — post what you made (renders, works in progress, experiments)',
              '- {#help} — stuck on something? ask here',
              '- {#feature-requests} — tell us what to build next',
              '- {#bug-reports} — something broke',
            ].join('\n'),
          ],
        },
        {
          name: 'announcements',
          topic: 'Updates and new releases',
          readOnly: true,
        },
      ],
    },
    {
      name: 'COMMUNITY',
      channels: [
        { name: 'general', topic: 'Anything goes — music, visuals, tools' },
        {
          name: 'showcase',
          topic: 'Share your renders and projects. Works in progress welcome.',
        },
      ],
    },
    {
      name: 'SUPPORT',
      channels: [
        { name: 'help', topic: 'Questions about using Cabin Visuals' },
        { name: 'feature-requests', topic: 'What should we build next?' },
        { name: 'bug-reports', topic: 'Something broke? Tell us what happened.' },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Discord REST helpers
// ---------------------------------------------------------------------------

const API = 'https://discord.com/api/v10';

async function api(method, path, body) {
  for (;;) {
    const res = await fetch(API + path, {
      method,
      headers: {
        Authorization: `Bot ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 429) {
      const data = await res.json();
      const wait = (data.retry_after ?? 1) * 1000 + 100;
      console.log(`  rate limited, waiting ${wait}ms...`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
    }

    return res.status === 204 ? null : res.json();
  }
}

// SEND_MESSAGES | SEND_MESSAGES_IN_THREADS | CREATE_PUBLIC_THREADS | CREATE_PRIVATE_THREADS
const DENY_POSTING = (
  (1n << 11n) | (1n << 46n) | (1n << 34n) | (1n << 35n)
).toString();

// ---------------------------------------------------------------------------

async function main() {
  console.log('Fetching current server state...');
  const existingRoles = await api('GET', `/guilds/${GUILD_ID}/roles`);
  const existingChannels = await api('GET', `/guilds/${GUILD_ID}/channels`);

  // --- roles ---
  for (const role of CONFIG.roles) {
    if (existingRoles.some((r) => r.name === role.name)) {
      console.log(`Role "${role.name}" already exists, skipping`);
      continue;
    }
    await api('POST', `/guilds/${GUILD_ID}/roles`, {
      name: role.name,
      color: role.color,
      hoist: role.hoist ?? false,
      mentionable: true,
    });
    console.log(`Created role "${role.name}"`);
  }

  // --- categories and channels ---
  const channelIdsByName = new Map(
    existingChannels.filter((c) => c.type === 0).map((c) => [c.name, c.id]),
  );
  const pendingMessages = []; // { channelId, channelName, content }

  for (const category of CONFIG.categories) {
    let cat = existingChannels.find(
      (c) => c.type === 4 && c.name.toLowerCase() === category.name.toLowerCase(),
    );
    if (cat) {
      console.log(`Category "${category.name}" already exists, skipping`);
    } else {
      cat = await api('POST', `/guilds/${GUILD_ID}/channels`, {
        name: category.name,
        type: 4,
      });
      console.log(`Created category "${category.name}"`);
    }

    for (const ch of category.channels) {
      const existing = existingChannels.find(
        (c) => c.type === 0 && c.name === ch.name && c.parent_id === cat.id,
      );
      if (existing) {
        console.log(`  #${ch.name} already exists, skipping`);
        continue;
      }

      const overwrites = ch.readOnly
        ? [{ id: GUILD_ID, type: 0, deny: DENY_POSTING, allow: '0' }]
        : [];

      const channel = await api('POST', `/guilds/${GUILD_ID}/channels`, {
        name: ch.name,
        type: 0,
        parent_id: cat.id,
        topic: ch.topic,
        permission_overwrites: overwrites,
      });
      console.log(`  Created #${ch.name}${ch.readOnly ? ' (read-only)' : ''}`);
      channelIdsByName.set(ch.name, channel.id);

      for (const content of ch.messages ?? []) {
        pendingMessages.push({ channelId: channel.id, channelName: ch.name, content });
      }
    }
  }

  // --- messages (posted last so {#channel} links resolve to real IDs) ---
  for (const msg of pendingMessages) {
    const content = msg.content.replace(/\{#([\w-]+)\}/g, (match, name) => {
      const id = channelIdsByName.get(name);
      return id ? `<#${id}>` : `#${name}`;
    });
    await api('POST', `/channels/${msg.channelId}/messages`, { content });
    console.log(`Posted message in #${msg.channelName}`);
  }

  console.log('\nDone. Review the server and tweak anything by hand or re-run after editing CONFIG.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
