import { MemoryBrowserJourneyStore } from '@src/core'
import { describeBrowserJourneyStore } from '../../../setup.js'

describeBrowserJourneyStore('MemoryBrowserJourneyStore', () => new MemoryBrowserJourneyStore())
