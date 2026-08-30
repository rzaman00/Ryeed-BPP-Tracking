clc;

%% Launch conditions and constants

g = 9.80665;                 % gravitational acceleration, m/s^2

P_site = 29.85;              % ACTUAL station pressure at launch site, inHg
T_site = 70;                 % launch-site air temperature, deg F

Weight_balloon = 1.605 + 0.650;   % balloon and neck equipment mass, kg
Weight_payloads = 7.238 - 0.650;  % suspended payload mass, kg


%% Do not change anything down here 


% Effective balloon drag coefficient.
% Keep this value if it has been validated against previous flights.
cd = 0.25;

% Specific gas constants
R_air = 287.05;              % dry air, J/(kg*K)
R_helium = 2077.1;           % helium, J/(kg*K)

%% Unit conversions and gas densities

P_site_Pa = P_site * 3386.389;                 % inHg to Pa
T_site_K = (T_site - 32) * (5 / 9) + 273.15;  % deg F to K

Rho_air = P_site_Pa / (R_air * T_site_K);         % air density, kg/m^3
Rho_helium = P_site_Pa / (R_helium * T_site_K);  % helium density, kg/m^3

%% Desired ascent rate

prompt = 'Desired ascent rate (m/s): ';
target_ascent_rate = input(prompt);

if ~isscalar(target_ascent_rate) || ...
        ~isreal(target_ascent_rate) || ...
        ~isfinite(target_ascent_rate) || ...
        target_ascent_rate <= 0

    error('Desired ascent rate must be one positive, finite real number.');
end

%% Balloon calculations

diameter_min = 2.0;          % minimum allowed launch diameter, m
diameter_max = 3.0;          % maximum allowed launch diameter, m

total_mass = Weight_balloon + Weight_payloads;

% Balloon volume as a function of diameter
volume_function = @(D) pi .* D.^3 ./ 6;

% Available lifting mass after supporting the balloon and payload
net_lift_mass_function = @(D) ...
    (Rho_air - Rho_helium) .* volume_function(D) - total_mass;

% Terminal ascent-rate model
ascent_rate_function = @(D) sqrt( ...
    8 .* g .* net_lift_mass_function(D) ./ ...
    (cd .* Rho_air .* pi .* D.^2));

% Diameter at which buoyancy exactly equals total system weight
liftoff_diameter = ...
    (6 * total_mass / (pi * (Rho_air - Rho_helium)))^(1 / 3);

if liftoff_diameter >= diameter_max
    error(['The balloon cannot produce positive free lift within the ', ...
           'specified diameter range of %.2f to %.2f m.'], ...
           diameter_min, diameter_max);
end

% Stay slightly above the zero-free-lift diameter so the ascent-rate
% expression remains real.
diameter_lower_bound = max( ...
    diameter_min, liftoff_diameter * (1 + 1e-9));

minimum_ascent_rate = ascent_rate_function(diameter_lower_bound);
maximum_ascent_rate = ascent_rate_function(diameter_max);

if target_ascent_rate < minimum_ascent_rate || ...
        target_ascent_rate > maximum_ascent_rate

    error(['The requested ascent rate is outside the range achievable ', ...
           'with diameters from %.2f to %.2f m. The available range is ', ...
           'approximately %.3f to %.3f m/s.'], ...
           diameter_min, diameter_max, ...
           minimum_ascent_rate, maximum_ascent_rate);
end

% Solve directly for the diameter that produces the requested ascent rate.
% This avoids missing the target because of a fixed 0.01 m step size.
Balloon_diameter = fzero( ...
    @(D) ascent_rate_function(D) - target_ascent_rate, ...
    [diameter_lower_bound, diameter_max]);

Ascent_rate = ascent_rate_function(Balloon_diameter);

%% Required scale-measured lift

Vol = volume_function(Balloon_diameter);

% This is the upward neck/nozzle lift that should be measured on the scale.
% The payload is not subtracted here because the scale measures the pull
% produced by the inflated balloon before the payload is released.
Lift_required_kg = ...
    (Rho_air - Rho_helium) * Vol - Weight_balloon;

Lift_required = Lift_required_kg * 2.20462262185;  % kg-force to lb-force

%% Approximate burst-altitude calculation

% Assumes a 10.5 m burst diameter for the Hwoyee 1600.
% This retains the original exponential-density approximation.
burst_diameter = 10.5;       % m

Vol_burst = (4 / 3) * pi * (burst_diameter / 2)^3;
Rat = Vol_burst / Vol;

% Approximate height gained above the launch site, not necessarily MSL.
Burst_alt = 7238.3 * log(Rat);       % m above launch site
Burst_alt_ft = Burst_alt * 3.28084;  % ft above launch site

%% Display results

fprintf('\nCalculated launch conditions:\n');
%fprintf('Air density:              %.4f kg/m^3\n', Rho_air);
%fprintf('Helium density:           %.4f kg/m^3\n', Rho_helium);
%fprintf('Balloon diameter:         %.3f m\n', Balloon_diameter);
%fprintf('Helium volume:            %.3f m^3\n', Vol);
fprintf('Expected ascent rate:     %.3f m/s\n', Ascent_rate);
fprintf('Required scale lift:      %.3f lb\n', Lift_required);
fprintf('Required PSI:             %.3f PSI\n', Lift_required*200);
fprintf('Approx. burst height:     %.0f m above launch site\n', Burst_alt);
fprintf('Approx. burst height:     %.0f ft above launch site\n', Burst_alt_ft);