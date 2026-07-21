import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  copyFile,
  exists,
  mkdir,
  readDir,
  readTextFile,
  rename,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

/** Tauri implementation of the portable DocumentStore contract. */
export function createTauriDocumentStore() {
  return {
    async chooseDirectory(options) {
      return open({ directory: true, multiple: false, recursive: true, ...options });
    },
    async grantDirectory(path) {
      return invoke("grant_project_access", { path });
    },
    readText: readTextFile,
    writeText: writeTextFile,
    exists,
    mkdir,
    readDirectory: readDir,
    rename,
    copyFile,
    writeFile,
  };
}
