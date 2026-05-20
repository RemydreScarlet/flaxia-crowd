import { WASI, File, Directory, PreopenDirectory } from "@bjorn3/browser_wasi_shim";
import type { ContainerPayload, ContainerResult } from "@flaxia/sdk";

export const runContainer = async (payload: ContainerPayload): Promise<ContainerResult> => {
  const { image, command, files, memoryLimitMb = 512 } = payload;

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

  const rootFiles: Record<string, File | Directory> = {};
  
  // Map input files
  for (const [path, base64] of Object.entries(files)) {
    const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    rootFiles[path] = new File(binary);
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
  const wasmResponse = await fetch(image);
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
