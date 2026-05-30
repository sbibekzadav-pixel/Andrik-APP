import { Router, type IRouter, type Request, type Response } from "express";
import { db, pushTokensTable } from "@workspace/db";

const router: IRouter = Router();

router.post("/push-tokens", async (req: Request, res: Response) => {
  const { token, platform } = req.body as { token?: unknown; platform?: unknown };

  if (typeof token !== "string" || !token.trim()) {
    res.status(400).json({ error: "token must be a non-empty string" });
    return;
  }
  if (platform !== "ios" && platform !== "android" && platform !== "web") {
    res.status(400).json({ error: "platform must be ios, android, or web" });
    return;
  }

  try {
    await db
      .insert(pushTokensTable)
      .values({ token: token.trim(), platform })
      .onConflictDoNothing({ target: pushTokensTable.token });
    res.status(201).json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "Failed to register token", detail: message });
  }
});

export default router;
