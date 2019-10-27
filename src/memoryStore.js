function MemoryStore() {
    this.concurrent = 0;
    this.routesTree = {};
    this.increment = function() {
        this.concurrent += 1;
        // console.log('[increment] concurrent  requests ', this.concurrent);
    };
    this.decrement = function() {
        if (this.concurrent > 0) {
            this.concurrent -= 1;
            // console.log('[decrement] concurrent  requests ', this.concurrent);
        }
    }
}


module.exports = MemoryStore;
