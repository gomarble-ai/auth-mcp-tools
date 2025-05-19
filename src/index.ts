import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from 'axios';
import { exec } from 'child_process';
import { promises as fs, existsSync } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import https from 'https';


// Create server instance
const server = new McpServer({
  name: "auth-mcp-tools",
  version: "1.0.6",
  capabilities: {
    resources: {},
    tools: {},
  },
});

// Get platform-specific app data path
const getAppDataPath = (): string => {
  const homeDir = os.homedir();
  
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'auth-mcp-tools');
    case 'darwin':
      return path.join(homeDir, 'Library', 'Application Support', 'auth-mcp-tools');
    case 'linux':
      return path.join(homeDir, '.config', 'auth-mcp-tools');
    default:
      return path.join(homeDir, '.auth-mcp-tools');
  }
};

// Helper function to open URLs
const openUrl = (url: string): Promise<void> => {
  const command = process.platform === 'win32' ? 'explorer' :
                 process.platform === 'darwin' ? 'open' : 'xdg-open';
  
  return new Promise((resolve, reject) => {
    exec(`${command} "${url}"`, (error) => {
      resolve();
    });
  });
};

server.tool(
    "get-tokens-api-keys-credentials-from-store",
    "This tool will get the tokens, api keys, and credentials for the user from the store",
    {},
    async () => {
        const appDataPath = getAppDataPath();
        const fullPath = path.join(appDataPath, "credentials.json");
        if (!existsSync(fullPath)) {
            return {
                content: [
                    { type: "text", text: "No credentials found in store. Please use the get-auth-token tool to get a token" }
                ]
            };
        }
        const credentials = await fs.readFile(fullPath, 'utf8');
        const credentialsJson = JSON.parse(credentials);
        return {
            content: [
                { type: "text", text: JSON.stringify(credentialsJson) }
            ]
        };
    }
);

async function generateAccessToken(url: string, key: string, credentialsJson: any, fullPath: string){
    const requestId = uuidv4();
    const authStartUrl = `${url}/start?request_id=${requestId}`;
    const tokenFetchUrl = `${url}/get-token?request_id=${requestId}`;

    await openUrl(authStartUrl);
    
    // Poll for token completion
    const maxAttempts = 6; // 1 minute (10-second intervals)
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            // Wait 10 seconds between attempts
            await new Promise(resolve => setTimeout(resolve, 10000));
            
            // Make request with timeout
            const response = await axios.get(tokenFetchUrl, { 
                httpsAgent: new https.Agent({ rejectUnauthorized: false }),
                timeout: 15000 
            });
            
            
            if (response.status !== 200) {
                continue;
            }
            
            const data = response.data;
            
            if (data.status === "pending") {
                continue;
            }
            
            if (data.status === "error") {
                throw new Error(`Error in generating access token: ${data.message || "Unknown error from auth server"}`);
            }                    
            if (data.status === "success") {
                for (const [dataKey, dataValue] of Object.entries(data)) {
                    if(dataKey === "status") continue;
                    credentialsJson[`${key}_${dataKey}`] = dataValue;
                }
                await fs.writeFile(fullPath, JSON.stringify(credentialsJson, null, 2));
                return data.access_token;
            }
        } catch (e: any) {
            throw new Error(`Error in generating access token: ${e.message || "Unknown error from auth server"}`);
        }
    }  
    throw new Error(`Timeout or maximum attempts reached: Authentication did not complete successfully within ${maxAttempts*10} seconds`);
}

async function refreshAccessToken(url: string, key: string, credentialsJson: any, fullPath: string, refreshToken: string){
    const refreshTokenUrl = `${url}/refresh-token?refresh_token=${refreshToken}`;
    const response = await axios.get(refreshTokenUrl, { 
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        timeout: 15000 
    });
    if (response.status !== 200) {
        throw new Error(`Error in refreshing token: ${response.data.message || "Unknown error from auth server"}`);
    }
    const data = response.data;
    if (data.status === "success") {
        for (const [dataKey, dataValue] of Object.entries(data)) {
            if(dataKey === "status") continue;
            credentialsJson[`${key}_${dataKey}`] = dataValue;
        }
        await fs.writeFile(fullPath, JSON.stringify(credentialsJson, null, 2));
        return data.access_token;
    }
    throw new Error(`Error in refreshing token: ${response.data.message || "Unknown error from auth server"}`);
}

server.tool(
    "get-auth-token",
    "Get an auth token for the user given auth url. This tool will check if token is already generated and saved to file. If not, it will generate a token and save it to file and return the token. If token is already generated and saved to file, it will return the token.",
    {
      url: z.string().describe("The auth url to generate a token"),
      force_generate_token: z.boolean().describe("If value is true then it will force the tool to generate a new token. This should be only used if the token is expired or invalid")
    },
    async ({ url, force_generate_token=false }) => {
        const appDataPath = getAppDataPath();
        const fullPath = path.join(appDataPath, "credentials.json");
        const credentials = await fs.readFile(fullPath, 'utf8');
        const credentialsJson = JSON.parse(credentials);
        const key = url.split("/").pop() || "";
        try{
            let token;
            const accessToken = credentialsJson[`${key}_access_token`];
            if(!accessToken){
                token = await generateAccessToken(url, key, credentialsJson, fullPath);
            } else {
                if(force_generate_token){
                    const refreshToken = credentialsJson[`${key}_refresh_token`];
                    if(refreshToken){
                        token = await refreshAccessToken(url, key, credentialsJson, fullPath, refreshToken);
                    }else{
                        token = await generateAccessToken(url, key, credentialsJson, fullPath);
                    }
                }else{
                    token = accessToken
                }
            }
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            status: "success",
                            oken: token
                        })
                    }
                ]
            };
        }catch(e: any){
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                        status: "error",
                        message: e.message
                    })
                }
                ]
            }
        }    
    }
)

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Auth MCP Server running on stdio");
  }
  
  main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
  });