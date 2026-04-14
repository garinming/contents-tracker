import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyD60h98U3EhQrBofE-xwg29DhYxrdz0BUk",
  authDomain: "tracker-9b4d2.firebaseapp.com",
  projectId: "tracker-9b4d2",
  storageBucket: "tracker-9b4d2.firebasestorage.app",
  messagingSenderId: "1004163679672",
  appId: "1:1004163679672:web:d96857b6503633305e3b4d",
  measurementId: "G-QVXD0RC72E"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
export default app;