/* 'Cards' object/class serves as an interface between firebase (current
 * data sync server), s3 (image server), and other javascripts, to make
 * possible migration to other server easier.
 *
 * Updated: 2015/07/31
 * Author: Lin, Yu-Wei
 */

/* Process:
 *  - Use 'card' as basic element.
 *  - Card has many 'fields': 'value'.
 *  - Use 'series' as info of repeating cards/random cards.
 *      - Only 'topic' is linked to series.
 *      - 'number' and 'order' are inheritated from series.
 *      - 'tag' could not be changed, but will be inheritated.
 *  - 'card': including the fields to show and return from front end.
 *    'card_data': including the fields to store in firebase.
 *
 * 1. Add/update card:
 *  - create a new empty card if key is empty or null. (new card)
 *  - check if 'repeat' is changed. if so, create/update a new series and add series key to card.
 *  - extract images info. ie. add/remove images.
 *  - upload/delete images + update card.
 * 2. Delete card:
 *  - if it's series, ask if delete 'repeat', if so change 'repeat' in series to 'once'.
 *  - delete all images.
 *  - delete the card.
 * 3. Get series cards by date:
 *  - check all the series and return the matched cards.
 *  - update counter of the matched 'series'.
 * 4. Get 'card':
 *  - translate from 'card_data' to 'card', and feed to callback.
 * 5. Add images to container:
 *  # Since downloading images takes time, show the card without image first and then add image src.
 */
/* Data Structure:
 * ->user_id:
 *      -> card
 *      -> other
 *          -> series
 *          -> topic
 *          -> tag
 *          (-> subdiary)
 * 
 * 1. card: (only send updated fields to add/update)
 *  - date: string('yyyy-MM-dd')
 *  - time: string('hh:mm')
 *  - topic: string
 *  - content: string
 *  - geolocation: {'name': string, 'logtitude': string, 'latitude': string};
 *  - series: string(key to series data)
 *  - tags: {string: true}
 *  - star: boolean
 *  - numbers: {string(name+unit): float(value)}
 *  - add_images: {path: src}
 *  - remove_images: {key: path}
 *  - repeat: {'day'/'week'/'month'/'year': {'info': {string: true}, 'interval': int, 'notification': string(hh:mm)}}
 *  - order: int
 * 
 * 2. card_data:
 *  - date: string
 *  - time: string
 *  - topic: string
 *  - content: string
 *  - series: string
 *  - tags: {string: true}
 *  - star: boolean
 *  - numbers: {string(name+unit): float(value)}
 *  - images: {key: path}
 *  - repeat: 
 *  - order: int
 * 
 * 3. image_data: {path: src}
 * 
 * 4. series: **only 'topic' is shared value.
 *  - topic: string
 *  - repeat: {'type': 'daily'/'weekly'/'monthly'/'yearly'/'random',
 *      'info': {int: true}, 'start': 'yyyy-MM-dd', 'interval': int, 'notification': string}}
 *  - time: string
 *  - numbers: {string(name+unit): true}
 *  - order: int
 *  - tags: {string: true}
 *  (- counter (-1 if infinite, poositive if only appear n times): int)
 *  - cards: {string(card key): true}
 * 
 * 5. unique fields/subdiary: (generally 'group by' in sql, also used for subdiary)
 *  @ key/name: string(value)
 *  - description: string
 *  - cards: {string(card key): true}
 */
/*
 * 'Cards' serves as the bridge/interface between front-end and server.
 * 
 * - Public Variables:
 *   -- ref: refernce to firebase card(_data)
 *   -- images: interface with images upload, load, and rempve.
 *   -- series: object in class Series, bridge to all series related actions
 *   -- unique_topic
 *   (-- unique_tag)
 *   (-- subdiary)
 *
 * - Private Variables:
 *   -- fields
 *   
 * - Public Methods:
 *   -- empty_card: return an empty card
 *      @return card
 *   -- add:
 *      @args: key, value
 *   -- remove:
 *      @args: key
 *   -- get:
 *      @args: key, callback(value)
 *   -- add_image_src:
 *      @args: path, $img
 *   -- get_series:
 *      @args: date, callback([cards])
 *   -- get_random:
 *      @args: n, callback([cards])
 *   -- list_unique_topic
 *      @args: callback(unique_topic)
 *
 * - Private Methods:
 *   -- 
 */
var Cards = function(ref, s3, events){
    this.ref = ref.child('cards');
    this.images = new Images(s3);
    this.series = new Series(ref.child('other/series'));
    this.unique_topic = new Unique(ref.child('other/unique_topic'), 'topic');
    
    var fields = {'series_share': {'topic': true, 'repeat': true},
                  'series': {'topic': true, 'repeat':true, 'numbers': true, 'time': true, 'order': true},
                  'images': {'add_images': true, 'remove_images': true}};

    this.empty_card = function(){
        var card = {
            date: '',
            time: '',
            topic: '',
            content: '',
            geolocation: {'name': '', 'longtitude': '', 'latitude': ''},
            series: '',
            tags: {},
            star: false,
            numbers: {},
            images: {},
            order: Number.MAX_VALUE
        };
        return JSON.parse(JSON.stringify(card));
    }

    this.add = function(key, value){
        console.log('Update card ' + key + ' with value ' + JSON.stringify(value));
        var ref = this.ref;
        var images = this.images;
        var series = this.series;
        var unique_topic = this.unique_topic;

        // push a new card_data if not found
        var post_ref;
        if (_.isNull(ref.child(key)))
            post_ref = ref.push(this.empty_card());
        else
            post_ref = ref.child(key);
        // images
        var images_value = _.pick(value, function(v,k,o){
            return _.has(fields.images, k);
        });
        value = _.omit(value, function(v,k,o){
            return _.has(fields.images, k);
        });
        images.upload_images(images.value.add_images, function(){
            if (_.isUndefined(images_value.add_images))
                return true;
            _.each(images_value.add_images, function(v,k,l){
                post_ref.child('images').push(k);
            });
        });
        images.delete_images(images_value.remove_images, function(){
            if (_.isUndefined(images_value.remove_images))
                return true;
            _.each(images_value.add_images, function(v,k,l){
                post_ref.child('images/'+k).remove();
            });
        });
        // series
            // 1) pick the value related to series
        var series_value = _.pick(value, function(v,k,o){
            return _.has(fields.series, k);
        });
            // 2) find out if create a new series
        var is_new_series = false;
        if (!_.isEmpty(series_value)){ // 2.1) if any change in series
            if (value.series==='') // 2.1.1) if no series is assigned
                is_new_series = true;
            else // 2.1.2) if a series is already assigned, ask user if he wants to overwrite or create a new one
                is_new_series = confirm('Create a new series?');
                if (is_new_series) // 2.1.3) remove card from old series
                    series.remove_card(value.series, post_ref.key());
        }
            // 3) create/update series
        if (is_new_series){ // 3.1) create a new series
            series.cards = {post_ref.key():true};
            value.series = series.add_series(post_ref.key(), series_value);
        } else{ // 3.2) update series
                // 3.2.1) extract the fields to be synced
            var series_share = _.pick(series_value, function(v,k,o){
                return _.has(fields.series_share, k);
            });
                // 3.2.2) update the series and the limked cards
            series.update_series(value.series, series_value, function(card_key, series_vlaue){
                ref.child(card_key).update(series_share);
            });
        }
        // unique topic
        if (_.has(value, 'topic'){
            unique_topic.add_card(value.topic, post_ref.key()); // add card to new topic
            post_ref.once('value', function(snapshot){ // remove card from old topic, might show error message
                var old_topic = snapshot.val().topic;
                unique_topic.remove_card(old_topic, post_ref.key());
            });
        }
        // cards
        post_ref.update(value);
    }

    this.remove = function(key){
        console.log('Remove card ' + key);
        var ref = this.ref;
        var images = this.images;
        var series = this.series;
        var unique_topic = this.unique_topic;

        ref.child(key).once('value', function(snapshot){
            var value = snapshot.val();
            if (value.series!=='') //series
                series.remove_card(value.series, key);
            _.each(value.images, function(v,k,o){ // images
                images.delete_images({v: true}, function(){});
            });
            unique_topic.remove_card(value.topic, key);
            ref.child(key).remove();
        });
    }

    this.get = function(key, callback){
        console.log('Get value of card ' + key);
        var ref = this.ref;
        ref.child(key).once('value', function(snapshot){
            callback(snapshot.val());
        });
    }

    this.add_image_src = function(path, $img){
        this.images.load_image_to(path, $img);
    }

    this.get_series = function(date, callback){
        this.series.get_repeat(date, callback);
    }

    this.get_random = function(n, callback){
        this.series.get_random(n, callback);
    }

    this.list_unique_topic = function(callback){
        this.unique_topic.list(callback);
    }
}

/* 'Images' handles all the actions related to large file, eg. images, video, audio, etc.
 * - Public Variables:
 *   -- s3
 * 
 * - Public Methods:
 *   -- upload_images: 
 *      @args: {path: src}, callback
 *   -- delete_images: 
 *      @args: {path: true}, callback
 *   -- load_image_to:
 *      @args: path, $img
 */
var Images = function(s3){
    this.s3 = s3;

    this.upload_images = function(images, callback){
        console.log('Upload images ' + JSON.stringify(_.keys(images)));
        var s3 = this.s3;
        
        if (_.isUndefined(images))
            return true;
        if (_.isEmpty(images))
            return true;

        var count_callback = _.after(_.size(images), callback);
        _.each(images, function(v, k, l){
            var params = {'Key': k, 'Body': v};
            s3.upload(params, function(err, data){
                if (err) console.log('S3 Upload Error: ' + err);
                else{
                    console.log('Successfully Upload: ' + k);
                    count_callback();
                }
            });
        });
    }

    this.delete_images = function(images, callback){
        console.log('Remove images ' + JSON.stringify(_.keys(images)));
        var s3 = this.s3;

        if (_.isUndefined(images))
            return true;
        if (_.isEmpty(images))
            return true;

        var params = {'Delete': {'Objects': [], 'Quiet': true}};
        for (var path in images){
            params['Delete']['Objects'].push({'Key': path});
        }
        s3.deleteObjects(params, function (err, data) {
            if (err) console.log('S3 Delete Error: ' + err);
            else {
                console.log('Successfully Delete: ' + JSON.stringify(_.keys(images)));
                callback();
            }
        });
    }

    this.load_image_to = function(path, $img){
        console.log('Load image ' + path);
        var s3 = this.s3;

        s3.getObject({'Key': path}, function(err, data){
            if (err) console.log('Error to get file from s3: ' + err);
            else $img.attr('src', data.Body);
        });
    }
}

/* 'Series' serves as the interface in cards to deal with repeat/random cards.
 * - Public Variables:
 *   -- ref: refernce to series (user/other/series)
 * 
 * - Public Methods:
 *   -- get_repeat
 *      @args: date(string), callback(all matched cards:[{series, topic, time, numbers, order, repeat, tags}])
 *   -- get_random
 *      @args: num(int), callback(all matched cards:[{series, topic, time, numbers, order, repeat, tags}])
 *   -- add_card
 *      @args: series key, card key
 *   -- remove_card
 *      @args: series key, card key
 *   -- add_series
 *      @args: value
 *      @return: series_key
 *   -- update_series
 *      @args: key, value, callback(card_key, value) <- what to do with cards associate with the series
 *   -- get_info
 *      @args: series key, callback(series repeat info)
 *   (-- update_counter)
 *
 * - Private Methods:
 *   -- card_value: convert series value to to-be-added card value
 *      @args: series value, series key
 *      @return: card with (series, topic, time, numbers, order, repeat, tags)
 *   -- is_match_date: check if the series repeat is matched the date.
 *      @args: date, series
 *      @return: true/false
 */
/* 'Unique' is the class for unique fields/subdiary
 * - Public Variables:
 *   -- ref
 *
 * - Public Methods:
 *   -- list
 *      @args: callback(data)
 *      @return: {key: {descrition: string, cards: {card_key: true}}}
 *   -- add_card
 *      @args: key, card_key
 *   -- remove_card
 *      @agrs: key, card_key
 *   -- add_description
 *      @args: key, description
 * 
 * - Private Methods:
 *   -- card_value:
 *      @args: one series data
 *      @return: card value
 */
var Series = function(ref){
    this.ref = ref;

    this.get_repeat = function(date, callback){
        console.log('Get repeat cards at ' + date + '.');
        var ref = this.ref;
        ref.once('value', function(snapshot){
            var val = snapshot.exportVal();
            var cards = [];
            _.each(val, function(v, k, l){
                if (is_match_date(date, v))
                    cards.push(card_value(v, k));
            });
            callback(cards);
        });
    }

    this.get_random = function(num, callback){
        console.log('Get ' + n + ' random card.');
        var ref = this.ref;
        // iterate through all series, get 'random' cards, and sample them.
        // may not be the fastest way
        ref.once('value', function(snapshot){
            var val = snapshot.exportVal();
            var random = [];
            _.each(val, function(v, k, l){
                if (v.repeat.type === 'random')
                    random.push(card_value(v, k));
            });
            var cards = _.sample(random, num);
            callback(cards);
        });    
    }

    this.get_info = function(key){
        console.log('Get repeat info from series ' + key);
        var ref = this.ref;
        ref.child(key).once('value', function(snapshot){
            callback(snapshot.val().repeat);
        });
    }

    this.add_card = function(series_key, card_key){
        console.log('Add card ' + card_key + ' to series ' + series_key);
        var ref = this.ref;
        ref.child(series_key+'/cards').update({card_key: true});
    }

    this.remove_card = function(series_key, card_key){
        console.log('Remove card ' + card_key + ' from series ' + series_key);
        var ref = this.ref;                
        ref.child(series_key+'/cards/'+card_key).remove(function(err){
            if (err) console.log(err);
            else{
                ref.child(series_key+'/cards').once('value', function(snapshot){
                    if (_.isNull(snapshot))
                        ref.child(series_key).remove();
                });
            }
        });
    }

    this.add_series = function(value){
        console.log('Add new series');
        var ref = this.ref;
        var post_ref = ref.push(value);
        return post_ref.key();
    }

    this.update_series = function(key, value, callback){
        console.log('Update series ' + key);
        var ref = this.ref;
        ref.child(key).update(value, function(err){
            if (err) console.log(err);
            else {
                ref.child(key+'/cards').once('value', function(snapshot){
                    var val = snapshot.val();
                    _.each(val, function(v, k, l){
                        callback(k, value);
                    });
                });
            }
        });
    }

    function card_value(series, series_key){
        var card = {};
        card.series = series_key;
        card.topic = series.topic;
        card.time = series.time;
        card.tags = series.tags;
        card.order = series.order;
        card.repeat = series.repeat;
        card.numbers = series.numbers;
        _.each(card.numbers, function(v,k,l){
            card.numbers[k] = null;
        });
    }

    function is_match_date(date, series){
        var current = new Date(date);
        // var start = new Date(series.repeat.start);
        var weekday = current.getDay(); //getUTCDay instead??
        var monthdate = current.getDate();
        switch(series.repeat.type){
            case 'daily':
                return true;
                break;
            case 'weekly':
                if (_.has(series.repeat.info, weekday.toString()))
                    return true;
                else
                    return false;
                break;
            case 'monthly':
                if (_.has(series.repeat.info, monthly.toString()))  
                    return true;
                else
                    return false;
                break;
            default:
                return false;
        }
    }
}

var Unique = function(ref, type){
    this.ref = ref;
    this.type = type;

    this.list = function(callback){
        console.log('List all cards in unique ' + this.type);
        var ref = this.ref;
        ref.once('value', function(snapshot){
            callback(snapshot.exportVal());
        });
    }

    this.add_card = function(key, card_key){
        console.log('Add card ' + card_key + ' to unique ' + this.type + ' with key ' + key);
        var ref = this.ref;
        if (ref.child(key)){
            ref.child(key+'/cards').update({card_key: true});
        } else{
            ref.child(key).set({'cards': {card_key: true}});
        }
    }

    this.remove_card = function(key, card_key){
        console.log('Remove card ' + card_key + ' from unique ' + this.type + ' with key ' + key);
        var ref = this.ref;
        ref.child(key+'/cards/'+card_key).remove(function(err){
            if (err) console.log(err);
            else{
                ref.child(key+'/cards').once('value',function(snapshot){
                    if(_.isNull(snapshot))
                        ref.child(key).remove();
                });
            }   
        });
    }

    this.add_description = function(key, description){
        console.log('Add description to key ' + key ' in unique ' + this.type);
        var ref = this.ref;
        if(ref.child(key))
            ref.child(key+'/description').set(description);
    }
}
/* 'Cards' includes all the actions related to data: add/update, remove
 * - Value stored in database:
 *   ~ group_key: string
 *   ~ date: string
 *   ~ numbers: {title: string, unit: string, value: string}
 *   ~ share: {string: true}
 *   ~ order: int
 *   ~ content: string
 *   ~ star: boolean
 *   ~ card_tags: {string: true}
 *   ~ images: {string(image key): string(image name/path)} on database
 * 
 * - 'Updated' value passed in argument:
 *   ~ topic: string
 *   ~ group_tags: {string: true}
 *   ~ repeat: {type:string, time:{string:true}}
 *   ~ date: string
 *   ~ numbers: {title: string, unit: string, value: string}
 *   ~ share: {string: true}
 *   ~ content: string
 *   ~ star: boolean
 *   ~ card_tags: {string: true}
 *   ~ add_images: {string(path): string:(src)}
 *   ~ delete_images: {string(key): string(path)}
 * 
 * - Variables:
 *   -- card_ref (card reference): reference links to firebase
 *   -- groups (group object): object including all actions interact with 
 *      group.
 *   -- s3 (aws s3): s3 object
 *   --  type: 'cards'
 * 
 * - Public Methods:
 *   -- *constructor:
 *      @args: firebase reference, s3, update events[add, change, remove]O
 *   -- add: add an empty card to database
 *      @args: 
 *      @return key
 *   TODO
 *   -- update: 
 *      @args: key, value, callback() <- no argument for callback
 *      @return: key
 *   -- populate_by_group: update the non-shared items
 *   TODO
 *   -- remove: remove card from database
 *      @args: key, callback()
 *      @return: true/false
 *   TODO
 *   -- get: get card from database by key, and execute callback when successes
 *      @args: key, callback(key, value)
 *      @return true/false
 *   TODO
 *   -- get_repeats: get the repeats by date
 *      @args: date
 *      @return: [new_cards]
 *   TODO
 *   -- is_visited: check if any card with certain date exists
 *      @args: date
 *      @return: true/false
 *   TODO: private or public?
 *   TODO
 *   -- get_all: get cards have certain value in certain field, and execute callback
 *      @args: field, field value, callback(key, value)
 *      @return: true/false
 *      ** Note: ref.orderByValue(field).equalTo(value).once('value', function(snapshot){
 *  snapshot.forEach(function(child_snapshot){
 *      ...
 *  }
 *      }
 *   TODO
 *   -- add_image_src: add image src to dom
 *      @args: $img, image name/path
 *      @return: true/false
 * - Private Methods:
 *   -- bind_events:
 *      @args:
 *          --- event name: string describing which event to bind, 
 *              'child_added'/'child_changed'/'child_remove'
 *          --- function: function to be executed
 *      @return: true/false
 *   -- group_changed: update group info 
 *      @args: group_key, group_value
 *      @return: true/false
 *   TODO
 *   -- get_update_value: parse the argument sent from outside to other_value, images_add, images_remove
 *      @args: value, old_value_data
 *      @return: [other_value, images_add, images_remove]
 *      ~ images_add: {path: src}
 *      ~ images_remove: {path: key}
 *   TODO
 *   -- update_images:
 *      @args: images_add(path: src}, images_remove{path: key}, post_ref, callback
 *   TODO
 *   -- remove_images:
 *      @args: images_remove {path: key}, callback
 *   TODO
 *   -- upload_image:
 *      @args: path, src, callback
 *   TODO
 *   -- if_group_exist: one topic maps to only one group/topic is unique among groups.
 *      @args: topic
 *      @return: true/undefined**
 */ 
var Cards = function(ref, s3, events){
    this.ref = ref.child('cards');
    this.s3 = s3;
    bind_events('child_added', events[0]);
    bind_events('child_changed', events[1]);
    bind_events('child_removed', events[2]);

    this.groups = new Groups(ref.child('groups'), [function(k,v){}, group_changed, function(k,v){}]);
    
    // Public Methods
        // add
    this.add = function(key, value, callback){
        console.log('Add ' + JSON.stringify(value) + ' to cards with key ' + key);
        // TODO
    }
        // remove
    this.remove = function(key, callback){
        console.log('Remove card with key ' + key);
        callback = get_object(callback, function(){});
        
        var ref = this.ref.child(key);
        var groups = this.groups;
        // remove images
        ref.once('value', function(snapshot){
            var value = snapshot.val();
            var images = get_object(value['images'], {});
            var group_key = get_object(value['group_key'], '');
            // -1 group count
            groups.update_count(group_key, -1);
            // remove data
            remove_images(_.invert(images), function(){
                ref.remove();
                callback();
            });
        })
    }
        // get
    this.get = function(key, callback){
        console.log('Get card\'s info with key ' + key);
        callback = get_object(callback, function(k,v){});

        var ref = this.ref.child(key);
        var groups = this.groups;
        ref.once('value', function(snapshot){
            var value = snapshot.val()
            var group_key = value['group_key'];
            groups.get(group_key, function(group_key2, group_value){
                _.extend(value, _.pick(group_value, 'topic', 'group_tags', 'repeat'));
                callback(key, value);
            });
        });
    }
        // add_image_src
    this.add_image_src = function($img, image_path){
        console.log('Download image source from ' + image_path);
        s3.getObject({'Key': image_path}, function(err, data){
            if (err) console.log('Error to get file from s3: ' + err);
            else $img.attr('src', data.Body);
        });
    }
    // Private Methods
        // bind_events
    function bind_events(event_name, func){
        func = get_object(func, function(){});
        ref.child('cards').on(event_name, function(snapshot){
            var key = snapshot.key();
            var value = snapshot.val();
            func(key, value);
        });
        return true;
    }
        // group_changed
    function group_changed(group_key, group_value){
        //TODO
        return true;
    }
        // get_update_value
    function get_update_value(value, old_value_data){
        var image_info = _.pick(value, 'images'); // {path: {key, src}}
        var new_other_data = get_object(_.omit(value, 'images'), {});
        new_other_data['images'] = {};
        var old_image_data = _.pick(old_value_data, 'images');
        // var old_other_data = _.omit(old_value_data, 'images');
        var images_add = {}; // {path: src}
        var images_remove = {}; //{path: key}
        
        _.each(image_info, function(v, k, l){
            if (v['key'] === ''){
                images_add[k] = v['src']
            }
        });
        _.each(old_image_data, function(v, k, l){
            if (!_.has(image_info, v)){
                images_remove[v] = k;
            }
        });
        return [new_other_data, images_add, images_remove];
    }
        // extract_group_info
    function extract_group_info(key, value){
        
    }
        // update_images
    function update_images(images_add, images_remove, post_ref, callback){
        callback = get_object(callback, function(){});
        
        _.each(images_add, function(src, path, l){
            upload_image(path, src, function(){
                post_ref.child('images').push(path);    
            });
        });

        remove_images(images_remove, function(){
            _.each(images_remove, function(key, path, l){
                post_ref.child('images').child(key).remove();
            });
        });
    }
        // remove_images
    function remove_images(images_remove, callback){
        console.log('Remove images ' + JSON.stringify(_keys(images_remove)));
        callback = get_object(callback, function(){});

        if (_.isEmpty(images_remove))
            return true;
        var params = {'Delete': {'Objects': [], 'Quiet': true}};
        for(var path in images_remove){
            params['Delete']['Objects'].push({'Key': path});
        }
        s3.deleteObjects(params, function (err, data) {
            if (err) {
                console.log('S3 Delete Error: ' + err);
            } else {
                console.log('Successfully Delete: ' + JSON.stringify(_.keys(images_remove)));
                callback();
            }
        }

    }
        // upload_image
    function upload_image(path, src, callback){
        console.log('Upload images ' + JSON.stringify(path));
        callback = get_object(callback, function(){});

        var params = {'Key': key, 'Body': src};
        this.s3.upload(params, function(err, data){
            if (err){
                console.log('S3 Upload Error: ' + err);
            } else{
                console.log('Successfully Upload: ' + key);
                callback();
            }
        });
    }
}
/* Groups: including all interactions related to groups
 * - Value: (all same in agrument and database)
 *   ~ topic: string, shared among group
 *   ~ group_tags: {string: true}, shared
 *   ~ repeat: {type:string, time:{string:true}}, shared
 *      ~~ type: 'once', 'daily', 'weekly', 'monthly', 'random', 'random'
 *   ~ numbers: {string: string}, not shared, only affect future cards
 *   ~ share: {string: true}, not shared
 *   ~ order: int, not shared
 *   ~ count: int, keep track of # of cards associated with this group.
 * - Variables:
 *   -- ref (reference): reference links to firebase
 *   -- type: 'groups'
 * - Public Methods:
 *   -- *constructor:
 *      @args: reference, bind evnets
 *      ~ reference: reference links to firebase
 *      ~ events: [add, update, remove], @args: key, value
 *   -- add: add group to database
 *      @agrs: key, value, callback() <- no argument for callback
 *      @return: key
 *   -- remove: remove group from database
 *      @agrs: key, callback()
 *      @return: true/false
 *   -- get: get group from database, and execute callback when successes
 *      @args: key, callback(key, value)
 *      @return true/false
 *   -- update_count: update the card number binded to group, and remove
 *          it when count is zero.
 *      @agrs: key, number, callback()
 *      @return: true/false
 *   TODO
 *   -- get_groups_by_date: get the to-be-added groups information by date
 *      @agrs: date
 *      @return: groups(dictionary)
 * - Private Methods:
 *   -- bind_events:
 *      @args:
 *          --- event name: string describing which event to bind, 
 *              'child_added'/'child_changed'/'child_remove'
 *          --- function: function to be executed
 *      @return: true/false
 *   TODO
 *   -- is_repeat_matched
 */
var Groups = function(ref, events){
    this.ref = ref;
    this.type = 'groups';
    
    bind_events('child_added', events[0]);
    bind_events('child_changed', events[1]);
    bind_events('child_removed', events[2]);

    // Public Methods
        // add
    this.add = function(key, value, callback){
        callback = get_object(callback, function(){});
        value = get_object(value);
        
        var post_ref;

        if(_.isUndefined(key) || key===''){
            console.log('Add ' + this.type + ' with value' + JSON.stringify(value));
            post_ref = this.ref.push(value);
        } else{
            console.log('Update ' + this.type + ' ' + key + ' with value ' + JSON.stringify(value));
            post_ref = this.ref.child(key);
            post_ref.update(value);
        }

        callback();
        return post_ref.key();
    }
        // remove
    this.remove = function(key, callback){
        callback = get_object(callback, function(){});
        console.log('Remove ' + this.type + ' with key ' + key);
        this.ref.child(key).remove();
        callback();
        return true;
    }
        // get
    this.get = function(key, callback){
        callback = get_object(callback, function(key, value){});
        console.log('Get ' + this.type + ' with key ' + key);
        this.ref.child(key).once('value', function(snapshot){
            callback(snapshot.key(), snapshot.val());
        }, function (errorObject) {
            console.log('The read from group with key ' + key + ' failed: ' + errorObject.code);
        });
        return true;
    }
        // update_count
    this.update_count = function(key, num, callback){
        num = get_object(num, 0);
        callback = get_object(callback, function(){});
        console.log('Update count of key: ' + key + ' with ' + num);
        var ref = this.ref;
        ref.child(key).child('count').once('value', function(snapshot){
            var count = snapshot.val();
            count += num;
            if (count===0)
                ref.child(key).remove();
            else
                ref.child(key).update({'count': count});
            callback();
        }, function (errorObject) {
            console.log('The read from group count with key ' + key + ' failed: '     + errorObject.code);                    
        });
        return true;
    }

    // Private Methods
        // bind_events
    function bind_events(event_name, func){
        func = get_object(func, function(){});
        ref.on(event_name, function(snapshot){
            var key = snapshot.key();
            var value = snapshot.val();
            func(key, value);
        });
        return true;
    }
}
