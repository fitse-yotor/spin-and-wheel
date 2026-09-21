import { useSyncExternalStore } from 'react'
import { getAuth, subscribeAuth } from './api'

export const useAuth = () => useSyncExternalStore(subscribeAuth, getAuth)
