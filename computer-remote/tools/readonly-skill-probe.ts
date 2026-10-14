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
          await computer.workspace.readText("provider-tests/remote/info.json"),
        ),
      );
      const output = await computer.commands.run({
        command: "python3",
        args: [
          "-c",
          "import json,pathlib,sys\nroot=pathlib.Path(sys.argv[1])\nmarker=b'GEA_PROVIDER_READONLY_PROBE'\nfiles=[p for p in root.rglob('SKILL.md') if marker in p.read_bytes()]\nif len(files)!=1: raise RuntimeError('Expected exactly one bundled probe Skill')\np=files[0]\nbefore=p.read_bytes()\ndenied=False\nerror=None\ntry:\n p.write_bytes(before)\nexcept OSError as exc:\n if exc.errno not in (1,13,30): raise\n denied=True\n error=str(exc)\nprint(json.dumps({'path':str(p),'readable':True,'unchanged':p.read_bytes()==before,'writeDenied':denied,'error':error}))",
          info.roots.skills,
        ],
        timeoutMs: 10000,
      });
      if (output.exitCode !== 0)
        return {
          status: "error",
          error: { operation: "readonly_skill_probe.python", ...output },
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
