import net from "net";

const BLENDER_HOST = "127.0.0.1";
const BLENDER_PORT = 9876;

export async function blenderExecute(code: string): Promise<{
  status: string;
  result?: { executed: boolean; result: string };
  message?: string;
}> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(120_000);

    const chunks: Buffer[] = [];

    socket.connect(BLENDER_PORT, BLENDER_HOST, () => {
      const msg = JSON.stringify({ type: "execute_code", params: { code } }) + "\n";
      socket.write(msg);
    });

    socket.on("data", (data) => {
      chunks.push(data);
      // Try to parse — if valid JSON we're done
      try {
        const full = Buffer.concat(chunks).toString();
        JSON.parse(full);
        socket.end();
      } catch {
        // keep reading
      }
    });

    socket.on("end", () => {
      try {
        const full = Buffer.concat(chunks).toString();
        resolve(JSON.parse(full));
      } catch (e) {
        reject(new Error(`Invalid response from Blender: ${e}`));
      }
    });

    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("Blender connection timed out"));
    });

    socket.on("error", (err) => {
      reject(new Error(`Blender connection failed: ${err.message}`));
    });
  });
}
