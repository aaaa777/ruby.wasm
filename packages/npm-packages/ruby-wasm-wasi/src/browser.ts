import { Fd, Inode, File, OpenFile, PreopenDirectory, Directory, WASI } from "@bjorn3/browser_wasi_shim";
import * as wasi from "../node_modules/@bjorn3/browser_wasi_shim/dist/wasi_defs.js";
import { consolePrinter } from "./console.js";
import { RubyVM } from "./vm.js";

export class RemoteFile extends Inode {
  data: Uint8Array;
  url: string;
  readonly: boolean;
  file_cache: ArrayBuffer | undefined;

  constructor(
    // data: ArrayBuffer | SharedArrayBuffer | Uint8Array | Array<number>,
    url: string,
    options?: Partial<{
      readonly: boolean;
    }>,
  ) {
    super();
    this.data = new Uint8Array();
    this.readonly = !!options?.readonly;
    this.url = url;
    this.file_cache = undefined;
  }

  fetch_file(): ArrayBuffer {
    if (this.file_cache === undefined) {
      fetch(this.url).then((response) => response.arrayBuffer()).then((buffer) => {
        this.file_cache = buffer;
        return buffer;
      });
    } else {
      return this.file_cache;
    }
  }

  // TODO: RESTに対応する仕組みにする
  path_open(oflags: number, fs_rights_base: bigint, fd_flags: number) {
    this.data = new Uint8Array(this.fetch_file());
    if (
      this.readonly &&
      (fs_rights_base & BigInt(wasi.RIGHTS_FD_WRITE)) ==
        BigInt(wasi.RIGHTS_FD_WRITE)
    ) {
      // no write permission to file
      return { ret: wasi.ERRNO_PERM, fd_obj: null };
    }

    if ((oflags & wasi.OFLAGS_TRUNC) == wasi.OFLAGS_TRUNC) {
      if (this.readonly) return { ret: wasi.ERRNO_PERM, fd_obj: null };
      this.data = new Uint8Array([]);
    }

    const file = new OpenFile(this);
    if (fd_flags & wasi.FDFLAGS_APPEND) file.fd_seek(0n, wasi.WHENCE_END);
    return { ret: wasi.ERRNO_SUCCESS, fd_obj: file };
  }

  get size(): bigint {
    this.data = new Uint8Array(this.fetch_file());
    return BigInt(this.data.byteLength);
  }

  stat(): wasi.Filestat {
    return new wasi.Filestat(wasi.FILETYPE_REGULAR_FILE, this.size);
  }
}

export const DefaultRubyVM = async (
  rubyModule: WebAssembly.Module,
  options: {
    consolePrint?: boolean;
    env?: Record<string, string> | undefined;
    fs?: Fd | undefined;
  } = {},
): Promise<{
  vm: RubyVM;
  wasi: WASI;
  instance: WebAssembly.Instance;
}> => {
  const args: string[] = [];
  const env: string[] = Object.entries(options.env ?? {}).map(
    ([k, v]) => `${k}=${v}`,
  );

  const fds: Fd[] = [
    new OpenFile(new File([])),
    new OpenFile(new File([])),
    new OpenFile(new File([])),
    new PreopenDirectory(
      "/", new Map<string, File | Directory>([
        ["sample2.txt", new File(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]))],
        ["mnt", new Directory(new Map([
          ["s.nomiss.net", new Directory(new Map([
            ["sample1.txt", new RemoteFile("./sample1.txt")],
          ],))],
        ]))],
      ])
    ),
  ];
  const wasi = new WASI(args, env, fds, { debug: false });
  const printer = options.consolePrint ?? true ? consolePrinter() : undefined;
  const { vm, instance } = await RubyVM.instantiateModule({
    module: rubyModule, wasip1: wasi,
    addToImports: (imports) => {
      printer?.addToImports(imports);
    },
    setMemory: (memory) => {
      printer?.setMemory(memory);
    }
  });

  return {
    vm,
    wasi,
    instance,
  };
};
