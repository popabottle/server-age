// Import necessary modules from Firebase SDK and node-fetch
import { initializeApp } from "firebase/app";
import { getFirestore, collection, doc, getDocs, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import fetch from 'node-fetch';
import http from 'http';

// --- CONFIGURATION ---
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
const POLLING_INTERVAL_MS = 45 * 1000; // 45 seconds to avoid rate-limiting
const SERVERS_COLLECTION = 'servers';
const MISSED_CYCLES_THRESHOLD = 10; // Number of cycles a server can be missed before being marked as closed
const DELETION_DELAY_MS = 24 * 60 * 60 * 1000; // 24 hours: time after a server is closed before it's deleted

// --- INITIALIZATION ---
let db;
try {
    console.log("Initializing Firebase connection...");
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    console.log("Firebase initialized successfully.");
} catch (error) {
    console.error("Firebase initialization failed:", error);
    process.exit(1);
}

// --- CORE MONITORING LOGIC ---
async function monitorServers() {
    const logTimestamp = `[${new Date().toISOString()}]`;
    console.log(`${logTimestamp} Running monitoring cycle...`);

    try {
        const response = await fetch(ROBLOX_API_URL);
        if (!response.ok) {
            console.error(`Error fetching from Roblox API: Roblox API returned status ${response.status}`);
            return;
        }
        const apiResult = await response.json();
        const apiServers = new Map(apiResult.data.map(server => [server.id, server]));

        const serversCollectionRef = collection(db, SERVERS_COLLECTION);
        const snapshot = await getDocs(serversCollectionRef);
        const dbServers = new Map();
        snapshot.forEach(doc => {
            dbServers.set(doc.id, doc.data());
        });
        
        const batch = writeBatch(db);
        const now = new Date();

        // Process servers currently in the API
        for (const [jobId, apiServerData] of apiServers) {
            const serverDocRef = doc(db, SERVERS_COLLECTION, jobId);
            const dbServerData = dbServers.get(jobId);

            if (dbServerData) {
                // If the server exists and was previously marked as 'missed', reset its counter
                if (dbServerData.missedCycles > 0) {
                    batch.update(serverDocRef, { missedCycles: 0 });
                }
            } else {
                // *** FIX: This is a new server. Log the current time as its creation time. ***
                console.log(`New server found: ${jobId}. Adding to database.`);
                batch.set(serverDocRef, {
                    jobId: jobId,
                    status: 'active',
                    created: now.toISOString(), // The monitor logs the creation time
                    missedCycles: 0
                });
            }
        }
        
        // Process servers that are in the database but NOT in the API anymore
        for (const [jobId, dbServerData] of dbServers) {
            const serverDocRef = doc(db, SERVERS_COLLECTION, jobId);

            // Handle potentially closed servers
            if (!apiServers.has(jobId) && dbServerData.status === 'active') {
                const newMissedCount = (dbServerData.missedCycles || 0) + 1;
                
                if (newMissedCount >= MISSED_CYCLES_THRESHOLD) {
                    console.log(`Server ${jobId} missed ${MISSED_CYCLES_THRESHOLD} cycles. Marking as closed.`);
                    const createdDate = new Date(dbServerData.created);
                    const finalUptime = (now - createdDate) / 1000;
                    batch.update(serverDocRef, { 
                        status: 'closed', 
                        finalUptime: finalUptime,
                        closedAt: now.toISOString()
                    });
                } else {
                     console.log(`Server ${jobId} missed. Incrementing missedCycles to ${newMissedCount}.`);
                    batch.update(serverDocRef, { missedCycles: newMissedCount });
                }
            }

            // Handle automatic deletion of old, closed servers
            if (dbServerData.status === 'closed' && dbServerData.closedAt) {
                const closedDate = new Date(dbServerData.closedAt);
                if ((now - closedDate) > DELETION_DELAY_MS) {
                    console.log(`Deleting old server record ${jobId} (closed for more than 24 hours).`);
                    batch.delete(serverDocRef);
                }
            }
        }
        
        await batch.commit();

    } catch (error) {
        console.error("An error occurred during the monitoring cycle:", error);
    } finally {
        console.log("Monitoring cycle complete.");
    }
}

// --- SERVER & SCHEDULER SETUP ---
console.log("Starting 24/7 Roblox Server Monitor.");
monitorServers();
setInterval(monitorServers, POLLING_INTERVAL_MS);
console.log(`Polling Roblox API every ${POLLING_INTERVAL_MS / 1000} seconds.`);

const port = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Monitoring service is running.\n');
}).listen(port, () => {
    console.log(`Health check server listening on port ${port}`);
});

