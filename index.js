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
	
	async getOne(name, params) {
		let url = this.makeURL(name, params);
		const resp = await this.fetchWithKey(url);
		const respObj = await resp.json();
		return respObj[name][0];
	}
	
	async getAllPages(name, params, limit = 100) {
		let url = this.makeURL(name, params);
		console.log(url);
		params["limit"] = limit;

		const fullArray = [];
		
		while (url) {
			const resp = await this.fetchWithKey(url);
			const respObj = await resp.json();
			fullArray.push(...respObj[name]);
			url = Object.hasOwn(respObj, "meta") ? respObj.meta.next : null;
		}
		
		return fullArray;
	}
	
	// Can't get ALL stops on the routes as yet
	async fetchStopsAndRoutes(minLon, maxLon, minLat, maxLat, {
		derivedProductNotForbidden = true,
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
		const routeIds = new Set();
		for (let stop of stops) {
			for (let {route} of stop.route_stops) {
				routeIds.add(route.id);
			}
		}
		
		const routes = [];
		for (let routeId of routeIds) {
			routes.push(await this.getOne("routes", {
				id: routeId,
				include_stops: true
			}));
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
			stopLocations[stop.stop_name] = [lat, lon];
		}
		
		window.collapsed = collapsed;
		
		const routeStops = {};
		for (let route of routes) {
			const thisStops = [];
			for (let {stop} of route.route_stops) {
				if (collapsed.has(stop.id)) {
					thisStops.push(collapsed.get(stop.id).stop_name);
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


