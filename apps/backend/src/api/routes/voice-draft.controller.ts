import { Body, Controller, Logger, Post } from '@nestjs/common';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';

class VoiceDraftDto {
  topic!: string;
}

@Controller('/voice-draft')
export class VoiceDraftController {
  constructor(private readonly _openaiService: OpenaiService) {}

  @Post()
  async generate(
    @GetOrgFromRequest() _org: Organization,
    @Body() body: VoiceDraftDto
  ): Promise<{ variants: string[] }> {
    if (!body?.topic || !body.topic.trim()) {
      return { variants: [] };
    }

    const raw = await this._openaiService.generatePosts(body.topic.trim());
    const variants: string[] = [];
    for (const group of raw || []) {
      if (!Array.isArray(group)) continue;
      for (const item of group) {
        const post = (item && (item as any).post) as string | undefined;
        if (post && post.trim()) variants.push(post.trim());
      }
    }

    Logger.log(
      `[voice-draft] topic="${body.topic.slice(0, 80)}" generated ${variants.length} variants`
    );

    return { variants };
  }
}
