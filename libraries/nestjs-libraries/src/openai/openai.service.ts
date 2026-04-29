import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { shuffle } from 'lodash';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// OpenAI is retained ONLY for image generation (DALL-E) and slide picture
// prompts. All text generation (post drafts, thread splitting, article
// extraction, voice transformation) flows through Claude so we can ground it
// in Connor's hand-picked voice library.
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'sk-proj-',
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

const TEXT_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-7';

// Voice library: hand-picked top-performing posts that ground Claude in
// Connor's actual writing style. Loaded at module init from the repo root.
type VoicePost = {
  id: string;
  url: string;
  genre: string;
  topic: string;
  body: string;
  reactions: number;
  comments: number;
  reposts: number | null;
};
type VoiceLibrary = {
  posts: VoicePost[];
  voice_notes: {
    patterns_observed: string[];
    do_not_imitate: string[];
  };
};

function loadVoiceLibrary(): VoiceLibrary {
  const candidates = [
    join(process.cwd(), 'voice-library.json'),
    join(process.cwd(), '..', 'voice-library.json'),
    join(__dirname, '..', '..', '..', '..', '..', 'voice-library.json'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, 'utf8')) as VoiceLibrary;
      } catch (e) {
        // fall through and try next candidate
      }
    }
  }
  return {
    posts: [],
    voice_notes: { patterns_observed: [], do_not_imitate: [] },
  };
}

const VOICE = loadVoiceLibrary();

function buildVoiceSystemPrompt(format: 'linkedin' | 'thread' = 'linkedin') {
  const examples = VOICE.posts
    .slice()
    .sort((a, b) => (b.reactions || 0) - (a.reactions || 0))
    .map(
      (p, i) =>
        `Example ${i + 1} — ${p.genre} (${p.reactions} reactions, ${p.comments} comments):\n${p.body}`
    )
    .join('\n\n---\n\n');

  const patterns = VOICE.voice_notes.patterns_observed
    .map((s) => `- ${s}`)
    .join('\n');
  const avoid = VOICE.voice_notes.do_not_imitate
    .map((s) => `- ${s}`)
    .join('\n');

  return `You are writing a LinkedIn post in Connor Renton's voice. Connor is the founder & CEO of Brodie Rec. League — the largest adult basketball league in the world (35,000+ athletes, 20+ cities, 11,000+ games a year, scaling to 50+ cities). His voice is direct, founder-first, and culture-forward.

VOICE PATTERNS YOU MUST FOLLOW:
${patterns || '- (no patterns recorded)'}

DO NOT IMITATE:
${avoid || '- (no anti-patterns recorded)'}

EXAMPLES OF HIS REAL POSTS (ranked by engagement):

${examples || '(no examples in library)'}

OUTPUT RULES:
- Write a single ${format === 'thread' ? 'thread (array of posts)' : 'LinkedIn post'} on the topic the user provides.
- Match Connor's rhythm: short declarative lines, vertical stat blocks, sparing emojis as punctuation, casual contractions.
- Default opener: pattern-interrupt with a known brand/figure if the topic allows.
- Always end with a CTA — "👇" + link or "Dm me".
- Never use corporate buzzwords. Never use hashtag walls. Never use em-dashes for pauses (use "...").
- Output ONLY the JSON the user asks for. No preamble, no explanation.`;
}

const PicturePrompt = z.object({
  prompt: z.string(),
});

const VoicePrompt = z.object({
  voice: z.string(),
});

@Injectable()
export class OpenaiService {
  // ============== IMAGE GENERATION (still OpenAI / DALL-E) ==============

  async generateImage(prompt: string, isUrl: boolean, isVertical = false) {
    const generate = (
      await openai.images.generate({
        prompt,
        response_format: isUrl ? 'url' : 'b64_json',
        model: 'dall-e-3',
        ...(isVertical ? { size: '1024x1792' } : {}),
      })
    ).data[0];

    return isUrl ? generate.url : generate.b64_json;
  }

  async generatePromptForPicture(prompt: string) {
    return (
      (
        await openai.chat.completions.parse({
          model: 'gpt-4.1',
          messages: [
            {
              role: 'system',
              content: `You are an assistant that take a description and style and generate a prompt that will be used later to generate images, make it a very long and descriptive explanation, and write a lot of things for the renderer like, if it${"'"}s realistic describe the camera`,
            },
            {
              role: 'user',
              content: `prompt: ${prompt}`,
            },
          ],
          response_format: zodResponseFormat(PicturePrompt, 'picturePrompt'),
        })
      ).choices[0].message.parsed?.prompt || ''
    );
  }

  async generateSlidesFromText(text: string) {
    for (let i = 0; i < 3; i++) {
      try {
        const message = `You are an assistant that takes a text and break it into slides, each slide should have an image prompt and voice text to be later used to generate a video and voice, image prompt should capture the essence of the slide and also have a back dark gradient on top, image prompt should not contain text in the picture, generate between 3-5 slides maximum`;
        const parse =
          (
            await openai.chat.completions.parse({
              model: 'gpt-4.1',
              messages: [
                {
                  role: 'system',
                  content: message,
                },
                {
                  role: 'user',
                  content: text,
                },
              ],
              response_format: zodResponseFormat(
                z.object({
                  slides: z
                    .array(
                      z.object({
                        imagePrompt: z.string(),
                        voiceText: z.string(),
                      })
                    )
                    .describe('an array of slides'),
                }),
                'slides'
              ),
            })
          ).choices[0].message.parsed?.slides || [];

        return parse;
      } catch (err) {
        console.log(err);
      }
    }

    return [];
  }

  // ============== TEXT GENERATION (Claude, voice-grounded) ==============

  async generateVoiceFromText(prompt: string) {
    const res = await anthropic.messages.create({
      model: TEXT_MODEL,
      max_tokens: 1024,
      system: `You take a social media post and convert it to a natural human-spoken voice script (for a character to read aloud). Real people don't use "-" — they use "..." for pauses. Use lots of pauses. Make it sound like a real person, not a press release. Output only the voice text, no preamble.`,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = res.content[0];
    return block && block.type === 'text' ? block.text.trim() : '';
  }

  async generatePosts(content: string) {
    // Returns an array-of-arrays of { post: string } — same shape as the
    // original OpenAI implementation so downstream code is unchanged.
    // We generate 5 LinkedIn-style single posts in Connor's voice.
    const variants = await Promise.all(
      Array.from({ length: 5 }).map(async () => {
        try {
          const res = await anthropic.messages.create({
            model: TEXT_MODEL,
            max_tokens: 1024,
            temperature: 1,
            system: buildVoiceSystemPrompt('linkedin'),
            messages: [
              {
                role: 'user',
                content: `Write a LinkedIn post about the following topic. Output strictly as a JSON array with exactly one element of shape { "post": string }. No preamble.\n\nTopic:\n${content}`,
              },
            ],
          });
          const block = res.content[0];
          const raw = block && block.type === 'text' ? block.text : '';
          const start = raw.indexOf('[');
          const end = raw.lastIndexOf(']');
          if (start === -1 || end === -1) return [];
          return JSON.parse(raw.slice(start, end + 1));
        } catch (e) {
          return [];
        }
      })
    );

    return shuffle(variants);
  }

  async extractWebsiteText(content: string) {
    const res = await anthropic.messages.create({
      model: TEXT_MODEL,
      max_tokens: 4096,
      system:
        'You take the full text of a webpage and extract only the article body. Strip nav, footer, related links, ads, and boilerplate. Return only the article text, no preamble.',
      messages: [{ role: 'user', content }],
    });
    const block = res.content[0];
    const articleContent = block && block.type === 'text' ? block.text : '';
    return this.generatePosts(articleContent);
  }

  async separatePosts(content: string, len: number) {
    const SeparatePostsSchema = z.object({
      posts: z.array(z.string()),
    });

    const splitRes = await anthropic.messages.create({
      model: TEXT_MODEL,
      max_tokens: 4096,
      system: `You take a social media post and break it into a thread. Each post must be a minimum of ${len - 10} and a maximum of ${len} characters, keeping the exact wording and line breaks. Split posts based on context boundaries. Output strictly as JSON: {"posts": string[]}. No preamble.`,
      messages: [{ role: 'user', content }],
    });
    const splitBlock = splitRes.content[0];
    const splitRaw = splitBlock && splitBlock.type === 'text' ? splitBlock.text : '';
    const objStart = splitRaw.indexOf('{');
    const objEnd = splitRaw.lastIndexOf('}');
    let posts: string[] = [];
    try {
      const parsed = JSON.parse(splitRaw.slice(objStart, objEnd + 1));
      posts = SeparatePostsSchema.parse(parsed).posts;
    } catch (e) {
      posts = [];
    }

    return {
      posts: await Promise.all(
        posts.map(async (post: any) => {
          if (post.length <= len) {
            return post;
          }

          let retries = 4;
          while (retries) {
            try {
              const shrinkRes = await anthropic.messages.create({
                model: TEXT_MODEL,
                max_tokens: 1024,
                system: `You take a social media post and shrink it to a maximum of ${len} characters, keeping the exact wording and line breaks. Output only the shrunk text, no preamble.`,
                messages: [{ role: 'user', content: post }],
              });
              const shrinkBlock = shrinkRes.content[0];
              return shrinkBlock && shrinkBlock.type === 'text'
                ? shrinkBlock.text.trim()
                : post;
            } catch (e) {
              retries--;
            }
          }

          return post;
        })
      ),
    };
  }
}
