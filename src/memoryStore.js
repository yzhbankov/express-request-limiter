function MemoryStore() {
    this.concurrent = 0;
    this.routesTree = {};
    this.arrayToTree = function(routesList = []) {
        if (Array.isArray(routesList) && routesList.length > 0) {
            routesList.forEach((route) => {
                if (!this.routesTree[route.path]) {
                    this.routesTree[route.path] = [route.method];
                } else {
                    this.routesTree[route.path].push(route.method);
                }
            })
        }
    };
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
