// worker.js - 24/7 Roblox Server Monitor Backend
// This script runs on a server (e.g., using Node.js) to provide continuous monitoring.

// --- IMPORTS ---
// You need to install these packages: npm install firebase node-fetch
import { initializeApp } from "firebase/app";
import { getFirestore, collection, doc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import fetch from 'node-fetch';

// --- CONFIGURATION ---
// IMPORTANT: Replace with your Firebase project's configuration.
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const ROBLOX_API_URL = 'https://games.roblox.com/v1/games/14289997240/servers/0?sortOrder=2&excludeFullGames=false&limit=100';
const POLLING_INTERVAL_MS = 15000; // Poll every 15 seconds to be safe.
const SERVERS_COLLECTION = 'servers'; // The name of our Firestore collection.

// --- INITIALIZATION ---
console.log("Initializing Firebase connection...");
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const serversCollectionRef = collection(db, SERVERS_COLLECTION);
console.log("Firebase initialized successfully.");

// --- CORE MONITORING LOGIC ---

/**
 * Fetches the current list of servers from the Roblox API.
 * @returns {Promise<Array>} A promise that resolves to an array of server objects.
 */
async function fetchRobloxServers() {
    try {
        const response = await fetch(ROBLOX_API_URL);
        if (!response.ok) {
            throw new Error(`Roblox API returned status ${response.status}`);
        }
        const json = await response.json();
        return json.data || [];
    } catch (error) {
        console.error("Error fetching from Roblox API:", error.message);
        return []; // Return empty array on failure to prevent crashing
    }
}

/**
 * Gets the current state of all servers we are tracking from Firestore.
 * @returns {Promise<Map<string, object>>} A map of server data with jobID as the key.
 */
async function getTrackedServersFromDB() {
    const serverSnapshot = await getDocs(serversCollectionRef);
    const trackedServers = new Map();
    serverSnapshot.forEach(doc => {
        trackedServers.set(doc.id, doc.data());
    });
    return trackedServers;
}


/**
 * The main monitoring loop that runs continuously.
 */
async function monitorServers() {
    console.log(`[${new Date().toISOString()}] Running monitoring cycle...`);

    // 1. Get the current state from both Roblox API and our Database
    const [liveServers, trackedServers] = await Promise.all([
        fetchRobloxServers(),
        getTrackedServersFromDB()
    ]);

    const liveServerIds = new Set(liveServers.map(s => s.id));
    console.log(`Found ${liveServers.length} live servers and ${trackedServers.size} tracked servers.`);

    // 2. Process new servers
    for (const server of liveServers) {
        if (!trackedServers.has(server.id)) {
            console.log(`New server found: ${server.id}. Adding to database.`);
            const newServerData = {
                jobId: server.id,
                created: new Date(server.created).toISOString(),
                status: 'active',
                finalUptime: 0,
                lastSeen: new Date().toISOString()
            };
            // Add the new server to Firestore. Use setDoc with the ID as the document name.
            await setDoc(doc(db, SERVERS_COLLECTION, server.id), newServerData);
        } else {
             // If we already track it, just update its 'lastSeen' timestamp
            const serverRef = doc(db, SERVERS_COLLECTION, server.id);
            await updateDoc(serverRef, { lastSeen: new Date().toISOString() });
        }
    }

    // 3. Process closed servers
    for (const [jobId, serverData] of trackedServers.entries()) {
        if (serverData.status === 'active' && !liveServerIds.has(jobId)) {
            console.log(`Server closed: ${jobId}. Updating status and final uptime.`);
            const createdDate = new Date(serverData.created);
            const closedDate = new Date();
            const finalUptime = Math.round((closedDate - createdDate) / 1000);

            const serverRef = doc(db, SERVERS_COLLECTION, jobId);
            await updateDoc(serverRef, {
                status: 'closed',
                finalUptime: finalUptime
            });
        }
    }
    console.log("Monitoring cycle complete.");
}

// --- START THE ENGINE ---
console.log("Starting 24/7 Roblox Server Monitor.");
console.log(`Polling Roblox API every ${POLLING_INTERVAL_MS / 1000} seconds.`);

// Run the monitor once immediately, then set it on an interval.
monitorServers();
setInterval(monitorServers, POLLING_INTERVAL_MS);
