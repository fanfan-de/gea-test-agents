import { defineTool } from "@gea-ai/agent-sdk";
import { Result } from "better-result";
import { z } from "zod";

const infoSchema = z.object({ roots: z.object({ skills: z.string().min(1) }) });
const outputSchema = z.object({
  path: z.string(),
  readable: z.boolean(),
  unchanged: z.boolean(),
  writeDenied: z.boolean(),
  error: z.string().nullable(),
});

export default defineTool({
  name: "readonly_skill_probe",
  description:
    "读取本 Agent 的独立测试 Skill，再尝试写回相同字节；验证执行用户无法写 Skills。",
  input: z.object({}),
  permissions: { workspace: ["read", "write"], commands: true },
  async execute(_, ctx) {
    const computer = ctx.computer;
    if (!computer)
      return {
        status: "error",
        error: { message: "Computer is unavailable." },
      };
    const result = await Result.tryPromise(async () => {
      const info = infoSchema.parse(
        JSON.parse(
          await computer.workspace.readText("provider-tests/default/info.json"),
        ),
      );
      const output = await computer.commands.run({
        command: "node",
        args: [
          "-e",
          "const fs=require('node:fs'),path=require('node:path');const files=[];function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())walk(p);else if(entry.name==='SKILL.md'&&fs.readFileSync(p).includes('GEA_PROVIDER_READONLY_PROBE'))files.push(p)}}walk(process.argv[1]);if(files.length!==1)throw new Error('Expected exactly one bundled probe Skill');const p=files[0],before=fs.readFileSync(p);let denied=false,error=null;try{fs.writeFileSync(p,before)}catch(e){if(!['EACCES','EPERM','EROFS'].includes(e.code))throw e;denied=true;error=e.message}process.stdout.write(JSON.stringify({path:p,readable:true,unchanged:fs.readFileSync(p).equals(before),writeDenied:denied,error}))",
          info.roots.skills,
        ],
        timeoutMs: 10000,
      });
      if (output.exitCode !== 0)
        return {
          status: "error",
          error: { operation: "readonly_skill_probe.node", ...output },
        };
      const probe = outputSchema.parse(JSON.parse(output.stdout));
      return {
        status:
          probe.readable && probe.unchanged && probe.writeDenied
            ? "passed"
            : "error",
        ...probe,
        exitCode: output.exitCode,
      };
    });
    if (result.isErr()) {
      const error = result.error;
      return {
        status: "error",
        error: {
          operation: "readonly_skill_probe",
          message:
            error.cause instanceof Error ? error.cause.message : error.message,
        },
      };
    }
    return result.value;
  },
});
