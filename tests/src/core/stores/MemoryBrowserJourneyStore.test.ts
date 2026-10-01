import { MemoryBrowserJourneyStore } from '@src/core'
import { describeBrowserJourneyStore } from './suite.js'

describeBrowserJourneyStore('MemoryBrowserJourneyStore', () => new MemoryBrowserJourneyStore())
