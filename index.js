class TransitLandWrapper {
	endpoint = "https://transit.land/api/v2/rest/";
	attributionURL = "https://www.transit.land/terms";
	attributionText = "Transit route/stops data from Transitland - see https://www.transit.land/terms";
	
	constructor(apikey) {
		this.apikey = apikey;
	}
	
	makeURL(path, params) {
		const url = new URL(path, this.endpoint);
		const searchParams = new URLSearchParams(params);
		url.search = searchParams.toString();
		return url;
	}
	
	fetchWithKey(url) {
		return fetch(url, {headers: {apikey: this.apikey}});
	}
	
	async getFullPage(name, params, path) {
		if (!path) { path = name; }
		let url = this.makeURL(path, params);
		const resp = await this.fetchWithKey(url);
		return await resp.json();
	}

	async getOnePage(name, params, path, limit = 100) {
		params["limit"] = limit;
		return (await this.getFullPage(name, params, path))[name];
	}
	
	async getOne(name, params, path) {
		return (await this.getOnePage(name, params, path))[0];
	}
	
	async getAllPages(name, params, path, limit = 100) {
		params["limit"] = limit;
		const fullArray = [];
		
		const respObj = await this.getFullPage(name, params, path);
		fullArray.push(...respObj[name]);
		let url = Object.hasOwn(respObj, "meta") ? respObj.meta.next : null;
		
		while (url) {
			const respObj = await (await this.fetchWithKey(url)).json();
			fullArray.push(...respObj[name]);
			url = Object.hasOwn(respObj, "meta") ? respObj.meta.next : null;
		}
		
		return fullArray;
	}
	
	async fetchStopsAndRoutes(minLon, maxLon, minLat, maxLat, {
		derivedProductNotForbidden = true,
		includeRefTrip = true,
		tripIndex = 0
		// pretty sure that this is the only one that matters because I'm not adapting the feed itself
	} = {}) {
		const params = {
			include_routes: true,
			include_geometry: true,
			bbox: `${minLon},${minLat},${maxLon},${maxLat}`
		};
		
		if (derivedProductNotForbidden) {
			params["license_create_derived_product"] = "exclude_no";
		}
		
		// Get stops first and then routes from stops as there will generally be more stops, so stops --> routes is less requests
		// than routes --> stops
		
		const stops = await this.getAllPages("stops", params);
		console.log(`Fetched ${stops.length} stops`);
		
		const routeIds = new Set();
		for (let stop of stops) {
			for (let {route} of stop.route_stops) {
				routeIds.add(route.id);
			}
		}
		
		const routes = [];
		let i = 0;
		for (let routeId of routeIds) {
			console.log(`Fetching route ${++i} of ${routeIds.size}`);
			
			const route = await this.getOne("routes", {
				id: routeId
			})
			console.log("Fetched route");
			
			if (includeRefTrip) {
				const routePath = `routes/${routeId}/trips`;
				const allTrips = await this.getOnePage("trips", {}, routePath);
				route.refTrip = await this.getOne("trips", {id: allTrips[tripIndex].id}, routePath);
				console.log("Fetched trip");
			}
			
			routes.push(route);
		}

		return {stops, routes};
	}
	
	idMap(array) {
		const idMap = new Map();
		for (let obj of array) {
			idMap.set(obj.id, obj)
		}
		return idMap;
	}
	
	collapseStops(stopIdMap, locationType) {
		// creates a new map where ids of child stops map to their parent stop (so there may be multiple ids for one value)
		const newMap = new Map();
		for (let stop of stopIdMap.values()) {
			if (stop.location_type >= locationType || !stop.parent) {
				newMap.set(stop.id, stop);
			} else {
				const parentId = stop.parent.id;
				if (stopIdMap.has(parentId)) {
					newMap.set(stop.id, stopIdMap.get(parentId));
				} else {
					throw `"${stop.stop_name}"'s parent "${stop.parent.stop_name}" is not in stopIdMap`;
				}					
			}
		}
		return newMap;
	}
	
	simplifyStopsAndRoutes(stops, routes, {
		collapseToLocationType = 1
	} = {}) {
		const stopIdMap = this.idMap(stops);
		const collapsed = this.collapseStops(stopIdMap, collapseToLocationType);
		
		
		const stopLocations = {};
		for (let stop of collapsed.values()) {
			const [lon, lat] = stop.geometry.coordinates;
			
			stopLocations[stop.id] = {
				name: stop.stop_name,
				lon, lat
			}
		}

		const routeStops = {};
		for (let route of routes) {
			
			let ids;
			if (route.refTrip) {
				ids = route.refTrip.stop_times.toSorted((a, b) => (a.stop_sequence - b.stop_sequence)).map((s) => (s.stop.id))
			} else {
				ids = route.route_stops.map((s) => (s.stop.id))
			}

			const thisStops = [];
			
			for (let id of ids) {
				if (collapsed.has(id)) {
					thisStops.push(collapsed.get(id).id);
				}
			}
			
			routeStops[route.route_long_name ?? route.route_short_name ?? route.onestop_id] = thisStops;
		}
		
		return {stopLocations, routeStops}
	}
	
	async fetchAndSimplifyStopsAndRoutes(minLon, maxLon, minLat, maxLat, {
		derivedProductNotForbidden = true,
		collapseToLocationType = 1
	} = {}) {
		const {stops, routes} = await this.fetchStopsAndRoutes(minLon, maxLon, minLat, maxLat, {derivedProductNotForbidden});
		return this.simplifyStopsAndRoutes(stops, routes, {collapseToLocationType});
	}
}

wrapper = new TransitLandWrapper("iwa_live_tlv2api_e9923d64045ea85e0a53ff8bb87bd023a4992e84b95629df1B3tPX")


