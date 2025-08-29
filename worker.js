// worker.js - 24/7 Roblox Server Monitor (Web Service Version)
// This script runs as a web service to stay awake on Render's free tier.
// CORRECTED: Added a check for valid date and increased polling interval to avoid rate limiting.

// --- IMPORTS ---
import { initializeApp } from "firebase/app";
import { getFirestore, collection, doc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import fetch from 'node-fetch';
import http from 'http'; // Import the built-in HTTP module

// --- CONFIGURATION ---
// !!! IMPORTANT: This has been updated with your Firebase project's configuration. !!!
const firebaseConfig = {
  apiKey: "AIzaSyDb3OPy_7Zc7cwlsC2Kz2cdzfT2R6HLseI",
  authDomain: "server-f6123.firebaseapp.com",
  projectId: "server-f6123",
  storageBucket: "server-f6123.appspot.com",
  messagingSenderId: "189465017648",
  appId: "1:189465017648:web:a07cee03ea2b9702ab9cf5",
  measurementId: "G-G66FFHRDSJ"
};

const ROBLOX_API_URL = 'https://games.roblox.com/v1/games/14289997240/servers/0?sortOrder=2&excludeFullGames=false&limit=100';
// *** FIX: Increased polling interval to 45 seconds to avoid 429 Too Many Requests error ***
const POLLING_INTERVAL_MS = 45000; 
const SERVERS_COLLECTION = 'servers';
const PORT = process.env.PORT || 10000; // Render provides a PORT environment variable

// --- INITIALIZATION ---
console.log("Initializing Firebase connection...");
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const serversCollectionRef = collection(db, SERVERS_COLLECTION);
console.log("Firebase initialized successfully.");

// --- CORE MONITORING LOGIC ---
async function fetchRobloxServers() {
    try {
        const response = await fetch(ROBLOX_API_URL);
        if (!response.ok) throw new Error(`Roblox API returned status ${response.status}`);
        const json = await response.json();
        return json.data || [];
    } catch (error) {
        console.error("Error fetching from Roblox API:", error.message);
        return [];
    }
}

async function getTrackedServersFromDB() {
    const serverSnapshot = await getDocs(serversCollectionRef);
    const trackedServers = new Map();
    serverSnapshot.forEach(doc => {
        trackedServers.set(doc.id, doc.data());
    });
    return trackedServers;
}

async function monitorServers() {
    console.log(`[${new Date().toISOString()}] Running monitoring cycle...`);
    const [liveServers, trackedServers] = await Promise.all([fetchRobloxServers(), getTrackedServersFromDB()]);
    const liveServerIds = new Set(liveServers.map(s => s.id));

    for (const server of liveServers) {
        if (!trackedServers.has(server.id)) {
            // *** FIX: Check if server.created is a valid date before using it ***
            const createdDate = server.created && !isNaN(new Date(server.created)) 
                ? new Date(server.created) 
                : new Date(); // Fallback to current time if invalid

            console.log(`New server found: ${server.id}. Adding to database.`);
            const newServerData = {
                jobId: server.id,
                created: createdDate.toISOString(),
                status: 'active',
                finalUptime: 0,
                lastSeen: new Date().toISOString()
            };
            // Use a try-catch block to handle potential Firestore permission errors gracefully
            try {
                await setDoc(doc(db, SERVERS_COLLECTION, server.id), newServerData);
            } catch (error) {
                console.error(`Firestore Error: Failed to add server ${server.id}.`, error.message);
            }
        } else {
            const serverRef = doc(db, SERVERS_COLLECTION, server.id);
            await updateDoc(serverRef, { lastSeen: new Date().toISOString() }).catch(err => console.error(`Firestore Error: Failed to update server ${server.id}.`, err.message));
        }
    }

    for (const [jobId, serverData] of trackedServers.entries()) {
        if (serverData.status === 'active' && !liveServerIds.has(jobId)) {
            console.log(`Server closed: ${jobId}. Updating status.`);
            const createdDate = new Date(serverData.created);
            const finalUptime = Math.round((new Date() - createdDate) / 1000);
            const serverRef = doc(db, SERVERS_COLLECTION, jobId);
            await updateDoc(serverRef, { status: 'closed', finalUptime: finalUptime }).catch(err => console.error(`Firestore Error: Failed to close server ${jobId}.`, err.message));
        }
    }
    console.log("Monitoring cycle complete.");
}

// --- START THE MONITORING ---
console.log("Starting 24/7 Roblox Server Monitor.");
console.log(`Polling Roblox API every ${POLLING_INTERVAL_MS / 1000} seconds.`);
monitorServers();
setInterval(monitorServers, POLLING_INTERVAL_MS);

// --- CREATE THE WEB SERVER ---
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Monitoring service is active.\n');
});

server.listen(PORT, () => {
  console.log(`Health check server listening on port ${PORT}`);
});
