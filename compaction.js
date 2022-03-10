const Record = require('./record')

module.exports = class Compaction {
  constructor(log, lastBlockIndex, opts, onDone) {
    // TODO opts?
    this.log = log
    this.onDone = onDone
    this.LAST_BLOCK_INDEX = lastBlockIndex

    this.uncompactedBlockIndex = -1
    this.uncompactedBlockBuf = null
    this.uncompactedOffset = 0

    this.compactedBlockBuf = null
    this.compactedOffset = 0

    this.unshiftedBlockIndex = 0
    this.unshiftedBlockBuf = 0
    this.unshiftedOffset = 0

    this.compactNextBlock()
  }

  continueCompactingBlock() {
    while (true) {
      const blockStart = this.uncompactedBlockIndex * this.log.blockSize
      const offsetInBlock = this.uncompactedOffset - blockStart
      const [nextOffset, dataBuf] = this.log.getDataNextOffset(
        this.uncompactedBlockBuf,
        this.uncompactedOffset
      )

      if (dataBuf === null) {
        if (!this.unshiftedBlockBuf) {
          this.getNextUnshiftedBlock(() => {
            this.continueCompactingBlock()
          })
          return
        }
        // All records have been shifted, end of log reached
        if (this.unshiftedBlockIndex === -1) {
          // FIXME: finalize ongoing writes before actually stopping
          this.stop(this.uncompactedBlockIndex)
          return
        }

        const unshiftedDataBuf = this.getNextUnshifted()
        if (unshiftedDataBuf === null) continue
        Record.write(this.compactedBlockBuf, offsetInBlock, unshiftedDataBuf)
        this.uncompactedOffset = nextOffset
      } else {
        Record.write(this.compactedBlockBuf, offsetInBlock, dataBuf)
        this.uncompactedOffset = nextOffset
      }

      if (nextOffset === 0) {
        this.log.overwrite(this.uncompactedBlockIndex, this.compactedBlockBuf)
        setImmediate(() => this.compactNextBlock())
        return
      }

      if (nextOffset === -1) {
        // FIXME: unless I'm missing something, this should never happen,
        // because the last block will not be compacted since it's still
        // work-in-progress (see the bail out in compactNextBlock())
        throw new Error('this should be unreachable')
      }
    }
  }

  getNextUnshiftedBlock(cb) {
    const nextBlockIndex = this.unshiftedBlockIndex + 1
    const nextBlockStart = nextBlockIndex * this.log.blockSize
    this.log.getBlock(nextBlockStart, (err, blockBuf) => {
      if (err) return this.onDone(err)
      this.unshiftedBlockIndex = nextBlockIndex
      this.unshiftedBlockBuf = blockBuf
      this.unshiftedOffset = nextBlockStart
      cb()
    })
  }

  getNextUnshifted() {
    while (true) {
      const [nextOffset, dataBuf] = this.log.getDataNextOffset(
        this.unshiftedBlockBuf,
        this.unshiftedOffset
      )

      if (dataBuf === null) {
        if (nextOffset === -1) {
          this.unshiftedBlockIndex = -1
          return null
        } else if (nextOffset === 0) {
          this.unshiftedBlockBuf = null
          return null
        } else {
          this.unshiftedOffset = nextOffset
          continue
        }
      } else {
        if (nextOffset === -1) {
          this.unshiftedBlockIndex = -1
          return dataBuf
        } else if (nextOffset === 0) {
          this.unshiftedBlockBuf = null
          return dataBuf
        } else {
          this.unshiftedOffset = nextOffset
          return dataBuf
        }
      }
    }
  }

  compactNextBlock() {
    const lastCompactedBlockIndex = this.uncompactedBlockIndex
    this.uncompactedBlockIndex += 1

    if (this.uncompactedBlockIndex === this.LAST_BLOCK_INDEX) {
      if (this.unshiftedBlockIndex === -1) {
        this.stop(lastCompactedBlockIndex)
      } else {
        this.stop(this.LAST_BLOCK_INDEX)
      }
      return
    }

    const blockStart = this.uncompactedBlockIndex * this.log.blockSize
    this.log.getBlock(blockStart, (err, blockBuf) => {
      if (err) return this.onDone(err)
      this.uncompactedBlockBuf = blockBuf
      this.uncompactedOffset = blockStart
      this.compactedBlockBuf = Buffer.alloc(this.log.blockSize)
      this.compactedOffset = blockStart
      if (this.unshiftedBlockIndex === this.uncompactedBlockIndex) {
        this.unshiftedBlockBuf = this.uncompactedBlockBuf
      }
      this.continueCompactingBlock()
    })
  }

  stop(lastBlockIndex) {
    this.uncompactedBlockIndex = -1
    this.uncompactedBlockBuf = null
    this.uncompactedOffset = -1
    this.compactedBlockBuf = null
    this.compactedOffset = -1
    this.unshiftedBlockIndex = -1
    this.unshiftedBlockBuf = null
    this.unshiftedOffset = -1
    this.onDone(null, lastBlockIndex)
  }
}
