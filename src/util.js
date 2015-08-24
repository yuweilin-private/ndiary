// Return an object, if is undefined, return default
// (default's defaulte is empty object {})
// @agrs: object, default
// @return: copied object
function get_object(obj, default_obj){
    if (_.isUndefined(obj)){
        return = (_.isUndefined(default_obj)) ? {} : default_obj;
    } else{
        return obj;
    }
}
