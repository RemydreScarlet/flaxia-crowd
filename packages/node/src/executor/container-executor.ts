import { WASI, File, Directory, PreopenDirectory } from "@bjorn3/browser_wasi_shim";
import type { ContainerPayload, ContainerResult } from "@flaxia/sdk";

const ALLOWED_PROTOCOLS = ['https:']
const BLOCKED_HOSTS = [
  '127.0.0.1', 'localhost', '0.0.0.0', '[::1]',
  '10.', '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.', '172.24.',
  '172.25.', '172.26.', '172.27.', '172.28.', '172.29.',
  '172.30.', '172.31.', '192.168.',
]

function validateImageUrl(urlStr: string): URL {
  let url: URL
  try {
    url = new URL(urlStr)
  } catch {
    throw new Error(`Invalid image URL: ${urlStr}`)
  }

  if (!ALLOWED_PROTOCOLS.includes(url.protocol)) {
    throw new Error(`Protocol not allowed: ${url.protocol}`)
  }

  const host = url.hostname.toLowerCase()
  for (const blocked of BLOCKED_HOSTS) {
    if (host === blocked || host.startsWith(blocked)) {
      throw new Error(`Image URL host blocked: ${host}`)
    }
  }

  if (!url.pathname.endsWith('.wasm')) {
    throw new Error(`Image URL must point to a .wasm file: ${url.pathname}`)
  }

  return url
}

export const runContainer = async (payload: ContainerPayload): Promise<ContainerResult> => {
  const { image, command, files, memoryLimitMb = 512 } = payload;
  const safeImageUrl = validateImageUrl(image);

  console.log(`Starting container: ${image} with command: ${command.join(' ')}`);

  // 1. Prepare Filesystem
  const fds: any[] = [];
  const stdoutBuffer: string[] = [];
  const stderrBuffer: string[] = [];

  // Mock stdout/stderr streams
  const stdout = {
    write: (data: Uint8Array) => {
      stdoutBuffer.push(new TextDecoder().decode(data));
      return data.length;
    }
  };
  const stderr = {
    write: (data: Uint8Array) => {
      stderrBuffer.push(new TextDecoder().decode(data));
      return data.length;
    }
  };

  const rootFiles = new Map<string, any>();
  
  // Map input files
  for (const [path, base64] of Object.entries(files)) {
    const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    rootFiles.set(path, new File(binary));
  }

  const rootDir = new PreopenDirectory("/", rootFiles);

  // 2. Initialize WASI
  const wasi = new WASI(command, [], [
    // stdin (empty)
    new File(new Uint8Array()),
    // stdout
    { write: stdout.write } as any,
    // stderr
    { write: stderr.write } as any,
    rootDir
  ]);

  // 3. Load and Instantiate WASM
  const wasmResponse = await fetch(safeImageUrl.toString());
  const wasmBinary = await wasmResponse.arrayBuffer();
  
  const { instance } = await WebAssembly.instantiate(wasmBinary, {
    wasi_snapshot_preview1: wasi.wasiImport
  });

  // 4. Run
  try {
    const exitCode = wasi.start(instance as any);
    
    // 5. Collect Output Files (any new files in root)
    const outputFiles: Record<string, string> = {};
    // Note: In a real implementation, we would diff the filesystem or look for specific outputs
    // For now, we collect anything that was modified or added if possible.
    // (Simplified for Phase 1)

    return {
      files: outputFiles,
      stdout: stdoutBuffer.join(''),
      stderr: stderrBuffer.join(''),
      exitCode
    };
  } catch (err) {
    return {
      files: {},
      stdout: stdoutBuffer.join(''),
      stderr: stderrBuffer.join(''),
      exitCode: -1
    };
  }
};
