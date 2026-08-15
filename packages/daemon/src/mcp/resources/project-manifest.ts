import type { McpServer } from "@modelcontextprotocol/server";
import type { ManifestService } from "../../indexer/manifest-service.js";

export const PROJECT_MANIFEST_URI = "project://manifest";

export function registerProjectManifestResource(
  server: McpServer,
  manifests: ManifestService,
  projectRoot: string
): void {
  server.registerResource(
    "project-manifest",
    PROJECT_MANIFEST_URI,
    {
      title: "Deterministic Project Manifest",
      description:
        "A canonical, token-bounded repository topology manifest with explicit exclusions and omissions.",
      mimeType: "application/json"
    },
    async (uri) => {
      const snapshot = manifests.getLatest(projectRoot) ?? manifests.indexProject(projectRoot);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: snapshot.canonicalJson
          }
        ]
      };
    }
  );
}
